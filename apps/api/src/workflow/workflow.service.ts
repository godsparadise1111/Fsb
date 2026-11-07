import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ProcessVersion } from '../process/entities/process-version.entity';
import { Organization } from '../organization/entities/organization.entity';
import { User } from '../identity/entities/user.entity';
import { UserPosition } from '../identity/entities/user-position.entity';
import { ForbiddenException } from '@nestjs/common';
import { ProcessInstance } from './entities/process-instance.entity';
import { WorkflowTask } from './entities/workflow-task.entity';
import { TaskAssignee } from './entities/task-assignee.entity';
import { WorkflowActionLog } from './entities/workflow-action-log.entity';
import { StartProcessDto } from './dto/start-process.dto';
import { ActTaskDto } from './dto/act-task.dto';
import { DelegateTaskDto } from './dto/delegate-task.dto';
import { TaskDelegation } from './entities/task-delegation.entity';
import { TenantAuditService } from '../tenant/tenant-audit.service';

@Injectable()
export class WorkflowService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ProcessVersion) private readonly versions: Repository<ProcessVersion>,
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ProcessInstance) private readonly instances: Repository<ProcessInstance>,
    @InjectRepository(WorkflowTask) private readonly tasks: Repository<WorkflowTask>,
    @InjectRepository(TaskAssignee) private readonly assignees: Repository<TaskAssignee>,
    private readonly tenantAudit: TenantAuditService,
  ) {}


  private deadlineFromHours(value: unknown): Date | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 8760) {
      throw new BadRequestException('Step dueInHours must be a number greater than 0 and no more than 8760');
    }
    return new Date(Date.now() + value * 3600000);
  }

  async startProcess(dto: StartProcessDto & { startedByUserId: string }) {
    return this.dataSource.transaction(async manager => {
      const version = await manager.findOne(ProcessVersion, { where: { id: dto.processVersionId, status: 'PUBLISHED' }, relations: { definition: true } });
      if (!version) throw new NotFoundException('Published process version not found');
      if (version.definition.organizationId !== dto.organizationId) throw new BadRequestException('Process version does not belong to the selected organization');
      const organization = await manager.findOne(Organization, { where: { id: dto.organizationId, isActive: true }, relations: { tenant: true } });
      if (!organization) throw new NotFoundException('Active organization not found');
      if (!organization.tenant || organization.tenant.status !== 'ACTIVE') throw new BadRequestException('The organization customer account is not active');
      const uniqueIds = [...new Set(dto.initialAssigneeUserIds)];
      const users = await manager.find(User, { where: { id: In(uniqueIds), isActive: true } });
      if (users.length !== uniqueIds.length) throw new BadRequestException('Every assignee must be an active user');
      const membershipCount = await manager.createQueryBuilder(UserPosition, 'membership')
        .innerJoin('membership.position', 'position').innerJoin('position.unit', 'unit')
        .innerJoin('tenant_memberships', 'tenantMembership', 'tenantMembership."userId" = membership."userId" AND tenantMembership."tenantId" = :tenantId AND tenantMembership."isActive" = true', { tenantId: organization.tenantId })
        .where('membership.userId IN (:...userIds)', { userIds: [...uniqueIds, dto.startedByUserId] })
        .andWhere('unit.organizationId = :organizationId', { organizationId: dto.organizationId })
        .andWhere('membership.isActive = true AND position.isActive = true AND unit.isActive = true')
        .andWhere('membership.validFrom <= CURRENT_TIMESTAMP AND (membership.validUntil IS NULL OR membership.validUntil >= CURRENT_TIMESTAMP)')
        .select('COUNT(DISTINCT membership.userId)', 'count').getRawOne();
      if (Number(membershipCount?.count ?? 0) !== new Set([...uniqueIds, dto.startedByUserId]).size) throw new BadRequestException('Starter and every assignee must have an active position in the selected organization');
      const configuredSteps = Array.isArray(version.schema?.steps) ? version.schema.steps as Array<{ dueInHours?: unknown }> : [];
      const firstDueAt = this.deadlineFromHours(configuredSteps[0]?.dueInHours);
      const instance = await manager.save(ProcessInstance, manager.create(ProcessInstance, {
        processVersionId: version.id, organizationId: dto.organizationId, startedByUserId: dto.startedByUserId,
        title: dto.title, data: dto.data ?? {}, status: 'RUNNING', currentStepIndex: 0,
      }));
      const task = await manager.save(WorkflowTask, manager.create(WorkflowTask, {
        processInstanceId: instance.id, title: dto.firstTaskTitle ?? 'بررسی و اقدام اولیه',
        assignmentPolicy: dto.assignmentPolicy ?? 'ALL_ASSIGNEES', status: 'OPEN', createdByUserId: dto.startedByUserId, dueAt: firstDueAt,
      }));
      await manager.save(TaskAssignee, uniqueIds.map(userId => manager.create(TaskAssignee, { taskId: task.id, userId, status: 'PENDING' })));
      return manager.findOne(WorkflowTask, { where: { id: task.id }, relations: { assignees: { user: true }, processInstance: true } });
    });
  }

  listMyTasks(userId: string, tenantId?: string | null) {
    if (!tenantId) return Promise.resolve([]);
    return this.tasks.createQueryBuilder('task')
      .leftJoin('task.assignees', 'assignment', 'assignment.userId = :userId AND assignment.status = :pending', { userId, pending: 'PENDING' })
      .leftJoinAndSelect('task.processInstance', 'instance')
      .innerJoin('instance.organization', 'organization', 'organization.tenantId = :tenantId', { tenantId })
      .leftJoinAndSelect('task.assignees', 'assignees')
      .where('task.status IN (:...statuses)', { statuses: ['OPEN', 'IN_PROGRESS'] })
      .andWhere(`(assignment.id IS NOT NULL OR EXISTS (
        SELECT 1 FROM task_delegations delegation
         JOIN task_assignees original ON original."taskId" = delegation."taskId"
          AND original."userId" = delegation."fromUserId" AND original.status = 'PENDING'
        WHERE delegation."taskId" = task.id AND delegation."toUserId" = :userId
          AND delegation."tenantId" = :tenantId AND delegation."revokedAt" IS NULL
          AND delegation."startsAt" <= now() AND delegation."endsAt" > now()
      ))`)
      .orderBy('task.dueAt', 'ASC', 'NULLS LAST')
      .addOrderBy('task.createdAt', 'ASC').getMany();
  }

  async act(taskId: string, userId: string, dto: ActTaskDto, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required for workflow actions');
    return this.dataSource.transaction(async manager => {
      const task = await manager.findOne(WorkflowTask, { where: { id: taskId }, relations: { processInstance: { organization: true } }, lock: { mode: 'pessimistic_write' } });
      if (!task) throw new NotFoundException('Task not found');
      if (task.processInstance.organization?.tenantId !== tenantId) throw new ForbiddenException('Task is outside the active tenant');
      if (!['OPEN', 'IN_PROGRESS'].includes(task.status)) throw new ConflictException('Task is no longer actionable');
      let assignment = await manager.findOne(TaskAssignee, { where: { taskId, userId }, lock: { mode: 'pessimistic_write' } });
      let actingDelegation: TaskDelegation | null = null;
      if (!assignment) {
        const delegations = await manager.find(TaskDelegation, {
          where: { taskId, tenantId, toUserId: userId, revokedAt: null },
          lock: { mode: 'pessimistic_write' },
        });
        const active = delegations.filter(item => item.startsAt <= new Date() && item.endsAt > new Date());
        if (active.length > 1) throw new ConflictException('Multiple active delegations exist for this task; administrator review is required');
        actingDelegation = active[0] ?? null;
        if (actingDelegation) {
          assignment = await manager.findOne(TaskAssignee, {
            where: { taskId, userId: actingDelegation.fromUserId, status: 'PENDING' },
            lock: { mode: 'pessimistic_write' },
          });
        }
      }
      if (!assignment) throw new BadRequestException('User is not assigned or an active delegate for this task');
      if (assignment.status !== 'PENDING') throw new ConflictException('This assignment has already been acted on');
      assignment.status = dto.action;
      assignment.comment = actingDelegation
        ? `Delegated action by ${userId}: ${dto.comment ?? ''}`.slice(0, 4000)
        : dto.comment ?? null;
      assignment.actedAt = new Date();
      await manager.save(assignment);
      if (actingDelegation) {
        actingDelegation.revokedAt = new Date();
        actingDelegation.revokedByUserId = userId;
        await manager.save(actingDelegation);
      }
      await manager.save(WorkflowActionLog, manager.create(WorkflowActionLog, { taskId, userId, action: dto.action, comment: dto.comment ?? null }));
      const all = await manager.find(TaskAssignee, { where: { taskId } });
      const rejected = all.some(item => item.status === 'REJECTED');
      const completed = task.assignmentPolicy === 'ANY_ASSIGNEE'
        ? dto.action === 'APPROVED'
        : all.every(item => item.status === 'APPROVED');
      if (rejected) {
        task.status = 'CANCELLED';
        const instance = await manager.findOneByOrFail(ProcessInstance, { id: task.processInstanceId });
        instance.status = 'CANCELLED';
        await manager.save(instance);
      } else if (completed) {
        task.status = 'COMPLETED';
        task.completedAt = new Date();
        const instance = await manager.findOne({ where: { id: task.processInstanceId }, relations: { processVersion: true } });
        if (!instance) throw new NotFoundException('Process instance not found');
        const rawSteps = instance.processVersion.schema?.steps;
        const steps = Array.isArray(rawSteps) ? rawSteps as Array<{ title?: string; instructions?: string; assigneeUserIds?: string[]; assignmentPolicy?: 'ANY_ASSIGNEE' | 'ALL_ASSIGNEES'; dueInHours?: unknown }> : [];
        const nextIndex = instance.currentStepIndex + 1;
        if (nextIndex < steps.length) {
          const next = steps[nextIndex];
          const nextUserIds = [...new Set(next.assigneeUserIds ?? [])];
          if (!nextUserIds.length) throw new BadRequestException('Every configured workflow step must have at least one assignee');
          const nextUsers = await manager.find(User, { where: { id: In(nextUserIds), isActive: true } });
          if (nextUsers.length !== nextUserIds.length) throw new BadRequestException('Every next-step assignee must be an active user');
          const nextMembershipCount = await manager.createQueryBuilder(UserPosition, 'membership')
            .innerJoin('membership.position', 'position').innerJoin('position.unit', 'unit')
            .innerJoin('tenant_memberships', 'tenantMembership', 'tenantMembership."userId" = membership."userId" AND tenantMembership."tenantId" = :tenantId AND tenantMembership."isActive" = true', { tenantId: instance.organization?.tenantId })
            .where('membership.userId IN (:...userIds)', { userIds: nextUserIds })
            .andWhere('unit.organizationId = :organizationId', { organizationId: instance.organizationId })
            .andWhere('membership.isActive = true AND position.isActive = true AND unit.isActive = true')
            .andWhere('membership.validFrom <= CURRENT_TIMESTAMP AND (membership.validUntil IS NULL OR membership.validUntil >= CURRENT_TIMESTAMP)')
            .select('COUNT(DISTINCT membership.userId)', 'count').getRawOne();
          if (Number(nextMembershipCount?.count ?? 0) !== nextUserIds.length) throw new BadRequestException('Every next-step assignee must have an active position in the process organization');
          const nextTask = await manager.save(WorkflowTask, manager.create(WorkflowTask, {
            processInstanceId: instance.id,
            title: next.title ?? `مرحله ${nextIndex + 1}`,
            instructions: next.instructions ?? null,
            assignmentPolicy: next.assignmentPolicy ?? 'ALL_ASSIGNEES',
            status: 'OPEN',
            createdByUserId: instance.startedByUserId,
            dueAt: this.deadlineFromHours(next.dueInHours),
          }));
          await manager.save(TaskAssignee, nextUserIds.map(userId => manager.create(TaskAssignee, { taskId: nextTask.id, userId, status: 'PENDING' })));
          instance.currentStepIndex = nextIndex;
          await manager.save(instance);
        } else {
          instance.status = 'COMPLETED';
          instance.completedAt = new Date();
          await manager.save(instance);
        }
      } else {
        task.status = 'IN_PROGRESS';
      }
      const remainingDelegations = await manager.find(TaskDelegation, { where: { taskId, tenantId, revokedAt: null } });
      for (const delegation of remainingDelegations) {
        if (task.status === 'COMPLETED' || task.status === 'CANCELLED' || delegation.fromUserId === userId) {
          delegation.revokedAt = new Date();
          delegation.revokedByUserId = userId;
          await manager.save(delegation);
          await this.tenantAudit.record(manager, {
            tenantId, actorUserId: userId, targetUserId: delegation.toUserId,
            action: 'workflow.task.delegation_closed', resourceType: 'TASK_DELEGATION', resourceId: delegation.id,
            metadata: { taskId, reason: task.status === 'COMPLETED' || task.status === 'CANCELLED' ? 'TASK_CLOSED' : 'ORIGINAL_ASSIGNEE_ACTED' },
          });
        }
      }
      await manager.save(task);
      return manager.findOne(WorkflowTask, { where: { id: taskId }, relations: { assignees: true, processInstance: true } });
    });
  }

  async delegateTask(taskId: string, actorUserId: string, dto: DelegateTaskDto, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required for task delegation');
    const endsAt = new Date(dto.endsAt);
    const now = new Date();
    if (!Number.isFinite(endsAt.getTime()) || endsAt <= now || endsAt.getTime() - now.getTime() > 30 * 86400000) {
      throw new BadRequestException('Delegation end time must be in the future and no more than 30 days away');
    }
    if (dto.toUserId === actorUserId) throw new BadRequestException('A task cannot be delegated to the same user');
    return this.dataSource.transaction(async manager => {
      const task = await manager.findOne(WorkflowTask, {
        where: { id: taskId },
        relations: { processInstance: { organization: true } },
        lock: { mode: 'pessimistic_write' },
      });
      if (!task) throw new NotFoundException('Task not found');
      if (task.processInstance.organization?.tenantId !== tenantId) throw new ForbiddenException('Task is outside the active tenant');
      if (!['OPEN', 'IN_PROGRESS'].includes(task.status)) throw new ConflictException('Only open tasks can be delegated');
      const ownAssignment = await manager.findOne(TaskAssignee, {
        where: { taskId, userId: actorUserId, status: 'PENDING' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ownAssignment) throw new ForbiddenException('Only the original pending assignee may delegate their assignment');
      const existing = await manager.findOne(TaskDelegation, {
        where: { taskId, fromUserId: actorUserId, revokedAt: null },
        lock: { mode: 'pessimistic_write' },
      });
      if (existing && existing.endsAt > now) throw new ConflictException('An active delegation already exists for this assignment');
      const target = await manager.findOne(User, { where: { id: dto.toUserId, isActive: true } });
      if (!target) throw new BadRequestException('Delegate must be an active user');
      const eligible = await manager.createQueryBuilder(UserPosition, 'membership')
        .innerJoin('membership.position', 'position').innerJoin('position.unit', 'unit')
        .innerJoin('tenant_memberships', 'tm', 'tm."userId" = membership."userId" AND tm."tenantId" = :tenantId AND tm."isActive" = true', { tenantId })
        .where('membership.userId = :userId', { userId: dto.toUserId })
        .andWhere('unit.organizationId = :organizationId', { organizationId: task.processInstance.organizationId })
        .andWhere('membership.isActive = true AND position.isActive = true AND unit.isActive = true')
        .andWhere('membership.validFrom <= CURRENT_TIMESTAMP AND (membership.validUntil IS NULL OR membership.validUntil >= CURRENT_TIMESTAMP)')
        .getCount();
      if (!eligible) throw new BadRequestException('Delegate must have an active position in the task organization and active tenant membership');
      const delegation = await manager.save(TaskDelegation, manager.create(TaskDelegation, {
        tenantId, taskId, fromUserId: actorUserId, toUserId: dto.toUserId,
        startsAt: now, endsAt, revokedAt: null, revokedByUserId: null,
      }));
      await this.tenantAudit.record(manager, {
        tenantId, actorUserId, targetUserId: dto.toUserId, action: 'workflow.task.delegated',
        resourceType: 'TASK_DELEGATION', resourceId: delegation.id,
        metadata: { taskId, originalAssigneeId: actorUserId, startsAt: now.toISOString(), endsAt: endsAt.toISOString() },
      });
      return delegation;
    });
  }

  async listTaskDelegations(taskId: string, requesterId: string, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const task = await this.tasks.findOne({ where: { id: taskId }, relations: { processInstance: true } });
    if (!task || task.processInstance.organization?.tenantId !== tenantId) throw new NotFoundException('Task not found');
    const [assigned, started] = await Promise.all([
      this.assignees.exist({ where: { taskId, userId: requesterId } }),
      this.instances.exist({ where: { id: task.processInstanceId, startedByUserId: requesterId } }),
    ]);
    const delegated = await this.dataSource.getRepository(TaskDelegation).exist({ where: { taskId, tenantId, toUserId: requesterId } });
    if (!assigned && !started && !delegated) throw new ForbiddenException('You are not allowed to view task delegations');
    return this.dataSource.getRepository(TaskDelegation).find({
      where: { taskId, tenantId }, order: { createdAt: 'DESC' },
    });
  }

  async revokeTaskDelegation(taskId: string, delegationId: string, actorUserId: string, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    return this.dataSource.transaction(async manager => {
      const task = await manager.findOne(WorkflowTask, {
        where: { id: taskId }, relations: { processInstance: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!task || task.processInstance.organization?.tenantId !== tenantId) throw new NotFoundException('Task not found');
      const delegation = await manager.findOne(TaskDelegation, {
        where: { id: delegationId, taskId, tenantId }, lock: { mode: 'pessimistic_write' },
      });
      if (!delegation) throw new NotFoundException('Task delegation not found');
      if (delegation.fromUserId !== actorUserId) throw new ForbiddenException('Only the original assignee may revoke this delegation');
      if (delegation.revokedAt) throw new ConflictException('Delegation has already been revoked');
      delegation.revokedAt = new Date();
      delegation.revokedByUserId = actorUserId;
      await manager.save(delegation);
      await this.tenantAudit.record(manager, {
        tenantId, actorUserId, targetUserId: delegation.toUserId,
        action: 'workflow.task.delegation_revoked', resourceType: 'TASK_DELEGATION', resourceId: delegation.id,
        metadata: { taskId },
      });
      return delegation;
    });
  }

  async taskHistory(taskId: string, requesterId: string, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required to view workflow history');
    if (!await this.tasks.exist({ where: { id: taskId } })) throw new NotFoundException('Task not found');
    const assigned = await this.assignees.exist({ where: { taskId, userId: requesterId } });
    const delegated = await this.dataSource.getRepository(TaskDelegation).exist({
      where: { taskId, tenantId, toUserId: requesterId },
    });
    const task = await this.tasks.findOne({ where: { id: taskId }, relations: { processInstance: { organization: true } } });
    if (task?.processInstance.organization?.tenantId !== tenantId) throw new ForbiddenException('Task history is outside the active tenant');
    if (!task || (!assigned && !delegated && task.processInstance.startedByUserId !== requesterId)) throw new ForbiddenException('You are not allowed to view this task history');
    return this.dataSource.getRepository(WorkflowActionLog).find({ where: { taskId }, relations: { user: true }, order: { createdAt: 'ASC' } });
  }
}