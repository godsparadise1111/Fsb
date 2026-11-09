import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
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
import { TaskDeferralRequest } from './entities/task-deferral-request.entity';
import { OrganizationSubstitution } from './entities/organization-substitution.entity';
import { OrganizationAbsence } from './entities/organization-absence.entity';
import { CreateOrganizationAbsenceDto } from './dto/create-organization-absence.dto';
import { WorkflowTaskReassignment } from './entities/workflow-task-reassignment.entity';
import { CreateOrganizationSubstitutionDto } from './dto/create-organization-substitution.dto';
import { RequestTaskDeferralDto, ReviewTaskDeferralDto } from './dto/request-task-deferral.dto';
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
        SELECT 1 FROM organization_substitutions substitution
         JOIN task_assignees original ON original."taskId" = task.id
          AND original."userId" = substitution."originalUserId" AND original.status = 'PENDING'
        WHERE substitution."organizationId" = instance."organizationId"
          AND substitution."tenantId" = :tenantId AND substitution."substituteUserId" = :userId
          AND substitution."revokedAt" IS NULL
          AND substitution."startsAt" <= now() AND substitution."endsAt" > now()
          AND EXISTS (SELECT 1 FROM tenant_memberships tm JOIN users su ON su.id = tm."userId" AND su."isActive" = true
                       WHERE tm."tenantId" = substitution."tenantId" AND tm."userId" = :userId AND tm."isActive" = true)
          AND EXISTS (SELECT 1 FROM user_positions up JOIN positions p ON p.id = up."positionId"
                       JOIN organization_units ou ON ou.id = p."organizationUnitId"
                      WHERE up."userId" = :userId AND ou."organizationId" = substitution."organizationId"
                        AND up."isActive" = true AND p."isActive" = true AND ou."isActive" = true
                        AND up."validFrom" <= now() AND (up."validUntil" IS NULL OR up."validUntil" >= now()))
      ) OR EXISTS (
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
      let actingSubstitution: OrganizationSubstitution | null = null;
      if (!assignment) {
        const substitutions = await manager.createQueryBuilder(OrganizationSubstitution, 'substitution')
          .innerJoin(TaskAssignee, 'original', 'original.taskId = :taskId AND original.userId = substitution.originalUserId AND original.status = :pending', { taskId, pending: 'PENDING' })
          .where('substitution.organizationId = :organizationId AND substitution.tenantId = :tenantId', { organizationId: task.processInstance.organizationId, tenantId })
          .andWhere('substitution.substituteUserId = :userId AND substitution."revokedAt" IS NULL', { userId })
          .andWhere('substitution."startsAt" <= :now AND substitution."endsAt" > :now', { now: new Date() })
          .andWhere(`EXISTS (SELECT 1 FROM tenant_memberships tm JOIN users su ON su.id = tm."userId" AND su."isActive" = true WHERE tm."tenantId" = substitution."tenantId" AND tm."userId" = :userId AND tm."isActive" = true)`, { userId })
          .andWhere(`EXISTS (SELECT 1 FROM user_positions up JOIN positions p ON p.id = up."positionId" JOIN organization_units ou ON ou.id = p."organizationUnitId" WHERE up."userId" = :userId AND ou."organizationId" = substitution."organizationId" AND up."isActive" = true AND p."isActive" = true AND ou."isActive" = true AND up."validFrom" <= now() AND (up."validUntil" IS NULL OR up."validUntil" >= now()))`, { userId })
          .setLock('pessimistic_write')
          .getMany();
        if (substitutions.length > 1) throw new ConflictException('Multiple active substitutions match this task; administrator review is required');
        actingSubstitution = substitutions[0] ?? null;
        if (actingSubstitution) {
          assignment = await manager.findOne(TaskAssignee, {
            where: { taskId, userId: actingSubstitution.originalUserId, status: 'PENDING' },
            lock: { mode: 'pessimistic_write' },
          });
        }
      }
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
        : actingSubstitution
          ? `Substitution action by ${userId} for ${actingSubstitution.originalUserId}: ${dto.comment ?? ''}`.slice(0, 4000)
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
      const activeAssignments = all.filter(item => item.status !== 'REASSIGNED');
      const completed = task.assignmentPolicy === 'ANY_ASSIGNEE'
        ? activeAssignments.some(item => item.status === 'APPROVED')
        : activeAssignments.length > 0 && activeAssignments.every(item => item.status === 'APPROVED');
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
      if (existing) {
        existing.revokedAt = now;
        existing.revokedByUserId = actorUserId;
        await manager.save(existing);
        await this.tenantAudit.record(manager, {
          tenantId, actorUserId, targetUserId: existing.toUserId,
          action: 'workflow.task.delegation_expired', resourceType: 'TASK_DELEGATION', resourceId: existing.id,
          metadata: { taskId, reason: 'REPLACED_AFTER_EXPIRY' },
        });
      }
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
    const task = await this.tasks.findOne({ where: { id: taskId }, relations: { processInstance: { organization: true } } });
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
        where: { id: taskId }, relations: { processInstance: { organization: true } },
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



  private async assertSubstituteCapacity(
    manager: EntityManager, tenantId: string, organizationId: string, substituteUserId: string,
    at: Date, sourceUserId?: string, policy?: { configured: boolean; enforceLimit: boolean; maxOpenTasksPerSubstitute: number },
  ) {
    // Serialize policy changes and all capacity checks for this organization.
    // The policy is read only after acquiring this lock, so a concurrent policy
    // activation cannot race past a request that observed the old disabled policy.
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [tenantId + ':' + organizationId + ':workload-policy']);
    const effectivePolicy = policy ?? await this.readOrganizationWorkloadPolicy(organizationId, tenantId, manager);
    if (!effectivePolicy.configured || !effectivePolicy.enforceLimit) return { checked: false, currentLoad: null };
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [tenantId + ':' + organizationId + ':' + substituteUserId]);
    const rows = await manager.query(
      `WITH open_load AS (
         SELECT wt.id AS "taskId"
           FROM task_assignees ta
           JOIN workflow_tasks wt ON wt.id=ta."taskId" AND wt."tenantId"=$1 AND wt.status IN ('OPEN','IN_PROGRESS')
           JOIN process_instances pi ON pi.id=wt."processInstanceId" AND pi."organizationId"=$2
          WHERE ta."userId"=$3 AND ta.status='PENDING'
         UNION
         SELECT wt.id
           FROM organization_substitutions s
           JOIN workflow_tasks wt ON wt."tenantId"=$1 AND wt.status IN ('OPEN','IN_PROGRESS')
           JOIN process_instances pi ON pi.id=wt."processInstanceId" AND pi."organizationId"=s."organizationId"
           JOIN task_assignees original ON original."taskId"=wt.id AND original."userId"=s."originalUserId" AND original.status='PENDING'
          WHERE s."tenantId"=$1 AND s."organizationId"=$2 AND s."substituteUserId"=$3
            AND s."revokedAt" IS NULL AND s."startsAt"<=$4 AND s."endsAt">$4
         UNION
         SELECT wt.id
           FROM task_assignees source
           JOIN workflow_tasks wt ON wt.id=source."taskId" AND wt."tenantId"=$1 AND wt.status IN ('OPEN','IN_PROGRESS')
           JOIN process_instances pi ON pi.id=wt."processInstanceId" AND pi."organizationId"=$2
          WHERE source."userId"=$5 AND source.status='PENDING'
         UNION
         SELECT wt.id
           FROM task_delegations td
           JOIN workflow_tasks wt ON wt.id=td."taskId" AND wt."tenantId"=$1 AND wt.status IN ('OPEN','IN_PROGRESS')
           JOIN process_instances pi ON pi.id=wt."processInstanceId" AND pi."organizationId"=$2
          WHERE td."tenantId"=$1 AND td."toUserId"=$3 AND td."revokedAt" IS NULL
            AND td."startsAt"<=$4 AND td."endsAt">$4
       ) SELECT COUNT(*)::int AS count FROM open_load`,
      [tenantId, organizationId, substituteUserId, at, sourceUserId ?? null],
    );
    const currentLoad = Number(rows[0]?.count ?? 0);
    if (currentLoad >= effectivePolicy.maxOpenTasksPerSubstitute) {
      throw new ConflictException(`Selected substitute has reached the organization workload limit (${currentLoad}/${effectivePolicy.maxOpenTasksPerSubstitute} open tasks at the planned start time)`);
    }
    return { checked: true, currentLoad };
  }

  async createOrganizationSubstitution(actorUserId: string, dto: CreateOrganizationSubstitutionDto, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    const now = new Date();
    const reason = dto.reason.trim();
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) ||
        startsAt < new Date(now.getTime() - 60000) || endsAt <= startsAt ||
        endsAt.getTime() - startsAt.getTime() > 90 * 86400000) {
      throw new BadRequestException('Substitution must have a valid start and end time, no more than 90 days');
    }
    if (dto.originalUserId === dto.substituteUserId) throw new BadRequestException('Original and substitute users must differ');
    if (reason.length < 5 || reason.length > 1000) throw new BadRequestException('A reason between 5 and 1000 characters is required');
    return this.dataSource.transaction(async manager => {
      const organization = await manager.findOne(Organization, { where: { id: dto.organizationId, tenantId, isActive: true } });
      if (!organization) throw new NotFoundException('Active organization not found in this tenant');
      const eligible = await manager.createQueryBuilder(UserPosition, 'up')
        .innerJoin('up.position', 'position').innerJoin('position.unit', 'unit')
        .innerJoin('tenant_memberships', 'tm', 'tm."tenantId" = :tenantId AND tm."userId" = up."userId" AND tm."isActive" = true', { tenantId })
        .innerJoin(User, 'u', 'u.id = up."userId" AND u."isActive" = true')
        .where('up."userId" IN (:...ids)', { ids: [dto.originalUserId, dto.substituteUserId] })
        .andWhere('unit."organizationId" = :organizationId AND unit."isActive" = true AND position."isActive" = true AND up."isActive" = true', { organizationId: dto.organizationId })
        .andWhere('up."validFrom" <= :startsAt AND (up."validUntil" IS NULL OR up."validUntil" >= :startsAt)', { startsAt })
        .select('COUNT(DISTINCT up."userId")', 'count').getRawOne();
      if (Number(eligible?.count ?? 0) !== 2) throw new BadRequestException('Both users must be active tenant members with valid positions in the organization at the substitution start');
      await this.assertSubstituteCapacity(manager, tenantId, dto.organizationId, dto.substituteUserId, startsAt, dto.originalUserId);
      const overlap = await manager.createQueryBuilder(OrganizationSubstitution, 's')
        .where('s.tenantId = :tenantId AND s.organizationId = :organizationId AND s.originalUserId = :originalUserId', {
          tenantId, organizationId: dto.organizationId, originalUserId: dto.originalUserId,
        })
        .andWhere('s.revokedAt IS NULL AND s.startsAt < :endsAt AND s.endsAt > :startsAt', { startsAt, endsAt })
        .getCount();
      if (overlap) throw new ConflictException('An overlapping substitution already exists for this employee and organization');
      const substitution = await manager.save(OrganizationSubstitution, manager.create(OrganizationSubstitution, {
        tenantId, organizationId: dto.organizationId, originalUserId: dto.originalUserId,
        substituteUserId: dto.substituteUserId, startsAt, endsAt, reason, createdByUserId: actorUserId,
        revokedAt: null, revokedByUserId: null,
      }));
      await this.tenantAudit.record(manager, {
        tenantId, actorUserId, targetUserId: dto.substituteUserId, action: 'workflow.organization_substitution.created',
        resourceType: 'ORG_SUBSTITUTION', resourceId: substitution.id,
        metadata: { organizationId: dto.organizationId, originalUserId: dto.originalUserId, substituteUserId: dto.substituteUserId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), reason },
      });
      return substitution;
    });
  }

  async listOrganizationSubstitutions(organizationId: string, tenantId?: string | null, limitValue?: string, offsetValue?: string) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const limit = limitValue === undefined ? 50 : Number(limitValue);
    const offset = offsetValue === undefined ? 0 : Number(offsetValue);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('limit must be between 1 and 100');
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000) throw new BadRequestException('offset must be between 0 and 100000');
    const organization = await this.organizations.findOne({ where: { id: organizationId, tenantId, isActive: true } });
    if (!organization) throw new NotFoundException('Organization not found');
    const [items, total] = await this.dataSource.getRepository(OrganizationSubstitution).findAndCount({
      where: { tenantId, organizationId }, order: { createdAt: 'DESC' }, take: limit, skip: offset,
    });
    return { items, total, limit, offset };
  }

  async revokeOrganizationSubstitution(organizationId: string, substitutionId: string, actorUserId: string, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    return this.dataSource.transaction(async manager => {
      const substitution = await manager.findOne(OrganizationSubstitution, {
        where: { id: substitutionId, tenantId, organizationId }, lock: { mode: 'pessimistic_write' },
      });
      if (!substitution) throw new NotFoundException('Substitution not found');
      if (substitution.revokedAt) throw new ConflictException('Substitution is already revoked');
      substitution.revokedAt = new Date();
      substitution.revokedByUserId = actorUserId;
      await manager.save(substitution);
      await this.tenantAudit.record(manager, {
        tenantId, actorUserId, targetUserId: substitution.substituteUserId,
        action: 'workflow.organization_substitution.revoked', resourceType: 'ORG_SUBSTITUTION',
        resourceId: substitution.id, metadata: { organizationId, originalUserId: substitution.originalUserId },
      });
      return substitution;
    });
  }

  async createOrganizationAbsence(actorUserId: string, dto: CreateOrganizationAbsenceDto, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    const reason = dto.reason.trim();
    const now = new Date();
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) ||
        startsAt < new Date(now.getTime() - 60000) || endsAt <= startsAt ||
        endsAt.getTime() - startsAt.getTime() > 90 * 86400000) {
      throw new BadRequestException('Absence must have a valid start and end time, no more than 90 days');
    }
    if (dto.userId === dto.substituteUserId) throw new BadRequestException('Absent user and substitute must differ');
    if (reason.length < 5 || reason.length > 1000) throw new BadRequestException('A reason between 5 and 1000 characters is required');
    return this.dataSource.transaction(async manager => {
      const organization = await manager.findOne(Organization, { where: { id: dto.organizationId, tenantId, isActive: true } });
      if (!organization) throw new NotFoundException('Active organization not found in this tenant');
      const eligible = await manager.createQueryBuilder(UserPosition, 'up')
        .innerJoin('up.position', 'position').innerJoin('position.unit', 'unit')
        .innerJoin('tenant_memberships', 'tm', 'tm."tenantId" = :tenantId AND tm."userId" = up."userId" AND tm."isActive" = true', { tenantId })
        .innerJoin(User, 'u', 'u.id = up."userId" AND u."isActive" = true')
        .where('up."userId" IN (:...ids)', { ids: [dto.userId, dto.substituteUserId] })
        .andWhere('unit."organizationId" = :organizationId AND unit."isActive" = true AND position."isActive" = true AND up."isActive" = true', { organizationId: dto.organizationId })
        .andWhere('up."validFrom" <= :startsAt AND (up."validUntil" IS NULL OR up."validUntil" >= :startsAt)', { startsAt })
        .select('COUNT(DISTINCT up."userId")', 'count').getRawOne();
      if (Number(eligible?.count ?? 0) !== 2) throw new BadRequestException('Absent user and substitute must be active tenant members with valid positions at the absence start');
      await this.assertSubstituteCapacity(manager, tenantId, dto.organizationId, dto.substituteUserId, startsAt, dto.userId);
      const substitution = await manager.save(OrganizationSubstitution, manager.create(OrganizationSubstitution, {
        tenantId, organizationId: dto.organizationId, originalUserId: dto.userId,
        substituteUserId: dto.substituteUserId, startsAt, endsAt, reason, createdByUserId: actorUserId,
        revokedAt: null, revokedByUserId: null,
      }));
      const absence = await manager.save(OrganizationAbsence, manager.create(OrganizationAbsence, {
        tenantId, organizationId: dto.organizationId, userId: dto.userId,
        substituteUserId: dto.substituteUserId, substitutionId: substitution.id,
        startsAt, endsAt, reason, createdByUserId: actorUserId,
        cancelledAt: null, cancelledByUserId: null,
      }));
      await this.tenantAudit.record(manager, {
        tenantId, actorUserId, targetUserId: dto.userId, action: 'workflow.organization_absence.created',
        resourceType: 'ORG_ABSENCE', resourceId: absence.id,
        metadata: { organizationId: dto.organizationId, substituteUserId: dto.substituteUserId, substitutionId: substitution.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), reason },
      });
      return absence;
    });
  }

  private async readOrganizationWorkloadPolicy(organizationId: string, tenantId: string, manager = this.dataSource.manager) {
    const rows = await manager.query(
      `SELECT "maxOpenTasksPerSubstitute", "warningThresholdPercent", "enforceLimit"
         FROM organization_workload_policies WHERE "tenantId" = $1 AND "organizationId" = $2`,
      [tenantId, organizationId],
    );
    const row = rows[0];
    return row ? {
      configured: true,
      maxOpenTasksPerSubstitute: Number(row.maxOpenTasksPerSubstitute),
      warningThresholdPercent: Number(row.warningThresholdPercent),
      enforceLimit: Boolean(row.enforceLimit),
    } : { configured: false, maxOpenTasksPerSubstitute: 10, warningThresholdPercent: 80, enforceLimit: false };
  }

  async getOrganizationWorkloadPolicy(organizationId: string, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const organization = await this.organizations.findOne({ where: { id: organizationId, tenantId, isActive: true } });
    if (!organization) throw new NotFoundException('Organization not found');
    return { organizationId, policy: await this.readOrganizationWorkloadPolicy(organizationId, tenantId) };
  }

  async updateOrganizationWorkloadPolicy(
    organizationId: string, tenantId: string | null | undefined, actorUserId: string,
    input: { maxOpenTasksPerSubstitute: number; warningThresholdPercent: number; enforceLimit: boolean },
  ) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const max = Number(input.maxOpenTasksPerSubstitute), warning = Number(input.warningThresholdPercent);
    if (!Number.isInteger(max) || max < 1 || max > 500) throw new BadRequestException('maxOpenTasksPerSubstitute must be between 1 and 500');
    if (!Number.isInteger(warning) || warning < 1 || warning > 100) throw new BadRequestException('warningThresholdPercent must be between 1 and 100');
    if (typeof input.enforceLimit !== 'boolean') throw new BadRequestException('enforceLimit must be a boolean');
    return this.dataSource.transaction(async manager => {
      const organization = await manager.findOne(Organization, { where: { id: organizationId, tenantId, isActive: true } });
      if (!organization) throw new NotFoundException('Organization not found');
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [tenantId + ':' + organizationId + ':workload-policy']);
      await manager.query(
        `INSERT INTO organization_workload_policies
          ("tenantId","organizationId","maxOpenTasksPerSubstitute","warningThresholdPercent","enforceLimit","updatedByUserId","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,now())
         ON CONFLICT ("tenantId","organizationId") DO UPDATE SET
          "maxOpenTasksPerSubstitute"=EXCLUDED."maxOpenTasksPerSubstitute",
          "warningThresholdPercent"=EXCLUDED."warningThresholdPercent",
          "enforceLimit"=EXCLUDED."enforceLimit",
          "updatedByUserId"=EXCLUDED."updatedByUserId","updatedAt"=now()`,
        [tenantId, organizationId, max, warning, input.enforceLimit, actorUserId],
      );
      await this.tenantAudit.record(manager, {
        tenantId, actorUserId, action: 'workflow.organization_workload_policy.updated',
        resourceType: 'ORGANIZATION', resourceId: organizationId,
        metadata: { maxOpenTasksPerSubstitute: max, warningThresholdPercent: warning, enforceLimit: input.enforceLimit },
      });
      return { organizationId, policy: await this.readOrganizationWorkloadPolicy(organizationId, tenantId, manager) };
    });
  }

  async getOrganizationWorkload(organizationId: string, tenantId?: string | null, atValue?: string, absentUserId?: string, substituteUserId?: string) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const asOf = atValue ? new Date(atValue) : new Date();
    if (!Number.isFinite(asOf.getTime())) throw new BadRequestException('at must be a valid ISO date-time');
    const organization = await this.organizations.findOne({ where: { id: organizationId, tenantId, isActive: true } });
    if (!organization) throw new NotFoundException('Organization not found');
    const rows = await this.dataSource.query(
      `WITH active_people AS (
        SELECT DISTINCT u.id, u."firstName", u."lastName", u.username
          FROM users u
          JOIN tenant_memberships tm ON tm."userId" = u.id AND tm."tenantId" = $1 AND tm."isActive" = true
          JOIN user_positions up ON up."userId" = u.id AND up."isActive" = true
          JOIN positions p ON p.id = up."positionId" AND p."isActive" = true
          JOIN organization_units ou ON ou.id = p."organizationUnitId" AND ou."organizationId" = $2 AND ou."isActive" = true
         WHERE u."isActive" = true AND up."validFrom" <= $3
           AND (up."validUntil" IS NULL OR up."validUntil" >= $3)
      ), task_load AS (
        SELECT ta."userId", wt.id AS "taskId", false AS "isSubstitution", false AS "isDelegated", false AS "isProspective"
          FROM task_assignees ta
          JOIN workflow_tasks wt ON wt.id = ta."taskId" AND wt.status IN ('OPEN', 'IN_PROGRESS')
          JOIN process_instances pi ON pi.id = wt."processInstanceId" AND pi."organizationId" = $2
         WHERE ta.status = 'PENDING'
        UNION ALL
        SELECT substitution."substituteUserId", wt.id, true, false, false
          FROM organization_substitutions substitution
          JOIN workflow_tasks wt ON wt.status IN ('OPEN', 'IN_PROGRESS')
          JOIN process_instances pi ON pi.id = wt."processInstanceId"
             AND pi."organizationId" = substitution."organizationId"
          JOIN task_assignees original ON original."taskId" = wt.id
             AND original."userId" = substitution."originalUserId" AND original.status = 'PENDING'
         WHERE substitution."tenantId" = $1 AND substitution."organizationId" = $2
           AND substitution."revokedAt" IS NULL
           AND substitution."startsAt" <= $3 AND substitution."endsAt" > $3
        UNION ALL
        SELECT candidate.id, wt.id, false, false, true
          FROM active_people candidate
          CROSS JOIN task_assignees source
          JOIN workflow_tasks wt ON wt.id=source."taskId" AND wt."tenantId"=$1 AND wt.status IN ('OPEN','IN_PROGRESS')
          JOIN process_instances pi ON pi.id=wt."processInstanceId" AND pi."organizationId"=$2
         WHERE $4::uuid IS NOT NULL AND source."userId"=$4 AND source.status='PENDING'
        UNION ALL
        SELECT td."toUserId", wt.id, false, true, false
          FROM task_delegations td
          JOIN workflow_tasks wt ON wt.id=td."taskId" AND wt."tenantId"=$1 AND wt.status IN ('OPEN','IN_PROGRESS')
          JOIN process_instances pi ON pi.id=wt."processInstanceId" AND pi."organizationId"=$2
         WHERE td."tenantId"=$1 AND td."revokedAt" IS NULL
           AND td."startsAt"<=$3 AND td."endsAt">$3
      ), aggregated AS (
        SELECT "userId", COUNT(DISTINCT "taskId") AS "openTaskCount",
               COUNT(DISTINCT "taskId") FILTER (WHERE "isSubstitution") AS "substitutionCoverageCount",
               COUNT(DISTINCT "taskId") FILTER (WHERE "isDelegated") AS "delegatedTaskCount",
               COUNT(DISTINCT "taskId") FILTER (WHERE "isProspective") AS "prospectiveCoverageCount"
          FROM task_load GROUP BY "userId"
      )
      SELECT people.id AS "userId", people."firstName", people."lastName", people.username,
             COALESCE(aggregated."openTaskCount", 0)::int AS "openTaskCount",
             COALESCE(aggregated."substitutionCoverageCount", 0)::int AS "substitutionCoverageCount",
             COALESCE(aggregated."delegatedTaskCount", 0)::int AS "delegatedTaskCount",
             COALESCE(aggregated."prospectiveCoverageCount", 0)::int AS "prospectiveCoverageCount"
        FROM active_people people
        LEFT JOIN aggregated ON aggregated."userId" = people.id
       ORDER BY (COALESCE(aggregated."openTaskCount", 0) + COALESCE(aggregated."prospectiveCoverageCount", 0)) DESC, people."lastName", people."firstName"`,
      [tenantId, organizationId, asOf, absentUserId ?? null],
    );
    const activeIds = new Set(rows.map((row: any) => String(row.userId)));
    if (absentUserId && !activeIds.has(absentUserId)) throw new BadRequestException('Absent employee is not an active member with a valid position in this organization at the requested time');
    if (substituteUserId && !activeIds.has(substituteUserId)) throw new BadRequestException('Substitute is not an active member with a valid position in this organization at the requested time');
    if (Boolean(absentUserId) !== Boolean(substituteUserId)) throw new BadRequestException('absentUserId and substituteUserId must be provided together');
    const policy = await this.readOrganizationWorkloadPolicy(organizationId, tenantId);
    return {
      organizationId,
      asOf: asOf.toISOString(),
      projection: absentUserId && substituteUserId ? { absentUserId, substituteUserId } : null,
      policy,
      items: rows.map((row: any) => ({
        userId: row.userId,
        firstName: row.firstName,
        lastName: row.lastName,
        username: row.username,
        openTaskCount: Number(row.openTaskCount ?? 0),
        substitutionCoverageCount: Number(row.substitutionCoverageCount ?? 0),
        delegatedTaskCount: Number(row.delegatedTaskCount ?? 0),
        prospectiveCoverageCount: Number(row.prospectiveCoverageCount ?? 0),
      })),
    };
  }

  async getOrganizationOperationalAlertSlaPolicy(organizationId: string, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const organization = await this.organizations.findOne({ where: { id: organizationId, tenantId, isActive: true } });
    if (!organization) throw new NotFoundException('Organization not found');
    const rows = await this.dataSource.query(
      `SELECT * FROM organization_operational_alert_sla_policies WHERE "tenantId"=$1 AND "organizationId"=$2`,
      [tenantId, organizationId],
    );
    if (rows.length) return rows[0];
    return {
      tenantId, organizationId, enabled: true,
      criticalResponseMinutes: 15, highResponseMinutes: 60, mediumResponseMinutes: 240, lowResponseMinutes: 1440,
      criticalResolutionHours: 4, highResolutionHours: 8, mediumResolutionHours: 24, lowResolutionHours: 72,
      configured: false,
    };
  }

  async updateOrganizationOperationalAlertSlaPolicy(
    organizationId: string, tenantId: string | null | undefined, actorUserId: string,
    dto: Record<string, unknown>,
  ) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const organization = await this.organizations.findOne({ where: { id: organizationId, tenantId, isActive: true } });
    if (!organization) throw new NotFoundException('Organization not found');
    const fields = [
      'criticalResponseMinutes','highResponseMinutes','mediumResponseMinutes','lowResponseMinutes',
      'criticalResolutionHours','highResolutionHours','mediumResolutionHours','lowResolutionHours',
    ];
    const defaults: Record<string, number> = {
      criticalResponseMinutes:15, highResponseMinutes:60, mediumResponseMinutes:240, lowResponseMinutes:1440,
      criticalResolutionHours:4, highResolutionHours:8, mediumResolutionHours:24, lowResolutionHours:72,
    };
    const values: Record<string, number> = {};
    for (const field of fields) {
      const value = dto[field] === undefined ? defaults[field] : Number(dto[field]);
      const max = field.endsWith('Minutes') ? 10080 : 720;
      if (!Number.isInteger(value) || value < 1 || value > max) throw new BadRequestException(`${field} must be an integer between 1 and ${max}`);
      values[field] = value;
    }
    if (typeof dto.enabled !== 'boolean') throw new BadRequestException('enabled must be a boolean');
    for (const severity of ['critical','high','medium','low']) {
      if (values[`${severity}ResolutionHours`] * 60 <= values[`${severity}ResponseMinutes`]) {
        throw new BadRequestException(`${severity} resolution target must be later than its response target`);
      }
    }
    return this.dataSource.transaction(async manager => {
      await manager.query(
        `INSERT INTO organization_operational_alert_sla_policies (
          "tenantId","organizationId","criticalResponseMinutes","highResponseMinutes","mediumResponseMinutes","lowResponseMinutes",
          "criticalResolutionHours","highResolutionHours","mediumResolutionHours","lowResolutionHours","enabled","updatedByUserId"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT ("tenantId","organizationId") DO UPDATE SET
          "criticalResponseMinutes"=EXCLUDED."criticalResponseMinutes","highResponseMinutes"=EXCLUDED."highResponseMinutes",
          "mediumResponseMinutes"=EXCLUDED."mediumResponseMinutes","lowResponseMinutes"=EXCLUDED."lowResponseMinutes",
          "criticalResolutionHours"=EXCLUDED."criticalResolutionHours","highResolutionHours"=EXCLUDED."highResolutionHours",
          "mediumResolutionHours"=EXCLUDED."mediumResolutionHours","lowResolutionHours"=EXCLUDED."lowResolutionHours",
          "enabled"=EXCLUDED."enabled","updatedByUserId"=EXCLUDED."updatedByUserId","updatedAt"=now()`,
        [tenantId,organizationId,values.criticalResponseMinutes,values.highResponseMinutes,values.mediumResponseMinutes,values.lowResponseMinutes,
          values.criticalResolutionHours,values.highResolutionHours,values.mediumResolutionHours,values.lowResolutionHours,dto.enabled,actorUserId],
      );
      if (dto.enabled) {
        await manager.query(
          `UPDATE organization_operational_alerts a SET
             "responseDueAt"=a."firstDetectedAt" + make_interval(mins => CASE a.severity
               WHEN 'CRITICAL' THEN $3 WHEN 'HIGH' THEN $4 WHEN 'MEDIUM' THEN $5 ELSE $6 END),
             "resolutionDueAt"=a."firstDetectedAt" + make_interval(hours => CASE a.severity
               WHEN 'CRITICAL' THEN $7 WHEN 'HIGH' THEN $8 WHEN 'MEDIUM' THEN $9 ELSE $10 END)
           WHERE a."tenantId"=$1 AND a."organizationId"=$2 AND a.status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')`,
          [tenantId,organizationId,values.criticalResponseMinutes,values.highResponseMinutes,values.mediumResponseMinutes,values.lowResponseMinutes,
            values.criticalResolutionHours,values.highResolutionHours,values.mediumResolutionHours,values.lowResolutionHours],
        );
      } else {
        await manager.query(
          `UPDATE organization_operational_alerts SET "responseDueAt"=NULL,"resolutionDueAt"=NULL
            WHERE "tenantId"=$1 AND "organizationId"=$2 AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')`,
          [tenantId,organizationId],
        );
      }
      await this.tenantAudit.record(manager, {
        tenantId, actorUserId, action:'organization.operational_alert_sla.updated',
        resourceType:'ORGANIZATION',resourceId:organizationId,
        metadata:{...values,enabled:dto.enabled},
      });
      const [result] = await manager.query(
        `SELECT * FROM organization_operational_alert_sla_policies WHERE "tenantId"=$1 AND "organizationId"=$2`,
        [tenantId,organizationId],
      );
      return result;
    });
  }

  async updateOperationalAlert(organizationId: string, alertId: string, actorUserId: string, tenantId: string | null | undefined, action: 'ACKNOWLEDGE' | 'ASSIGN' | 'RESOLVE' | 'REOPEN', assignedToUserId?: string | null, note?: string) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const organization = await this.organizations.findOne({ where: { id: organizationId, tenantId, isActive: true } });
    if (!organization) throw new NotFoundException('Organization not found');
    if (action === 'ASSIGN') {
      if (!assignedToUserId) throw new BadRequestException('A follow-up owner is required');
      const eligible = await this.dataSource.query(`SELECT 1 FROM users u JOIN tenant_memberships tm ON tm."userId"=u.id AND tm."tenantId"=$1 AND tm."isActive"=true WHERE u.id=$2 AND u."isActive"=true LIMIT 1`, [tenantId, assignedToUserId]);
      if (!eligible.length) throw new BadRequestException('Follow-up owner must be an active member of this tenant');
    }
    if (action === 'RESOLVE' && (!note || note.trim().length < 3)) throw new BadRequestException('Resolution note must contain at least 3 characters');
    return this.dataSource.transaction(async manager => {
      const rows = await manager.query(`SELECT * FROM organization_operational_alerts WHERE id=$1 AND "tenantId"=$2 AND "organizationId"=$3 FOR UPDATE`, [alertId,tenantId,organizationId]);
      if (!rows.length) throw new NotFoundException('Operational alert not found');
      const current = rows[0], now = new Date();
      if (action === 'ACKNOWLEDGE') {
        if (['RESOLVED','IGNORED'].includes(current.status)) throw new ConflictException('Closed alerts cannot be acknowledged');
        await manager.query(`UPDATE organization_operational_alerts SET status='ACKNOWLEDGED',"acknowledgedByUserId"=$4,"acknowledgedAt"=$5,"updatedAt"=$5 WHERE id=$1 AND "tenantId"=$2 AND "organizationId"=$3`, [alertId,tenantId,organizationId,actorUserId,now]);
      } else if (action === 'ASSIGN') {
        if (['RESOLVED','IGNORED'].includes(current.status)) throw new ConflictException('Closed alerts cannot be assigned');
        await manager.query(`UPDATE organization_operational_alerts SET "assignedToUserId"=$4,status='IN_PROGRESS',"acknowledgedByUserId"=COALESCE("acknowledgedByUserId",$5),"acknowledgedAt"=COALESCE("acknowledgedAt",$6),"updatedAt"=$6 WHERE id=$1 AND "tenantId"=$2 AND "organizationId"=$3`, [alertId,tenantId,organizationId,assignedToUserId,actorUserId,now]);
      } else if (action === 'RESOLVE') {
        if (['RESOLVED','IGNORED'].includes(current.status)) throw new ConflictException('Alert is already closed');
        await manager.query(`UPDATE organization_operational_alerts SET status='RESOLVED',"resolvedByUserId"=$4,"resolvedAt"=$5,"resolutionNote"=$6,"updatedAt"=$5 WHERE id=$1 AND "tenantId"=$2 AND "organizationId"=$3`, [alertId,tenantId,organizationId,actorUserId,now,note!.trim()]);
      } else {
        await manager.query(`UPDATE organization_operational_alerts SET status='OPEN',"acknowledgedByUserId"=NULL,"acknowledgedAt"=NULL,"resolvedByUserId"=NULL,"resolvedAt"=NULL,"resolutionNote"=NULL,"updatedAt"=$4 WHERE id=$1 AND "tenantId"=$2 AND "organizationId"=$3`, [alertId,tenantId,organizationId,now]);
      }
      await manager.query(
        `INSERT INTO organization_operational_alert_events ("tenantId","organizationId","alertId","actorUserId","eventType","fromStatus","toStatus","note","assignedToUserId")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [tenantId, organizationId, alertId, actorUserId, action, current.status,
          action === 'ACKNOWLEDGE' ? 'ACKNOWLEDGED' : action === 'ASSIGN' ? 'IN_PROGRESS' : action === 'RESOLVE' ? 'RESOLVED' : 'OPEN',
          action === 'RESOLVE' ? note!.trim() : null, action === 'ASSIGN' ? assignedToUserId : null],
      );
      await this.tenantAudit.record(manager, { tenantId, actorUserId, action: `organization.operational_alert.${action.toLowerCase()}`, resourceType: 'ORGANIZATION_OPERATIONAL_ALERT', resourceId: alertId, metadata: { organizationId, assignedToUserId: action === 'ASSIGN' ? assignedToUserId : undefined, note: action === 'RESOLVE' ? note!.trim() : undefined } });
      const result = await manager.query(`SELECT id,"alertKey",type,severity,title,description,"resourceId",status,"assignedToUserId","acknowledgedAt","resolvedAt","resolutionNote","firstDetectedAt","lastDetectedAt","responseDueAt","resolutionDueAt","escalatedAt","escalationLevel" FROM organization_operational_alerts WHERE id=$1 AND "tenantId"=$2 AND "organizationId"=$3`, [alertId,tenantId,organizationId]);
      return result[0];
    });
  }

  async addOperationalAlertNote(organizationId: string, alertId: string, actorUserId: string, tenantId: string | null | undefined, note: string) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const clean = typeof note === 'string' ? note.trim() : '';
    if (clean.length < 3 || clean.length > 4000) throw new BadRequestException('Note must contain between 3 and 4000 characters');
    const organization = await this.organizations.findOne({ where: { id: organizationId, tenantId, isActive: true } });
    if (!organization) throw new NotFoundException('Organization not found');
    return this.dataSource.transaction(async manager => {
      const rows = await manager.query(
        `SELECT id,status FROM organization_operational_alerts WHERE id=$1 AND "tenantId"=$2 AND "organizationId"=$3 FOR UPDATE`,
        [alertId, tenantId, organizationId],
      );
      if (!rows.length) throw new NotFoundException('Operational alert not found');
      if (['RESOLVED', 'IGNORED'].includes(rows[0].status)) throw new ConflictException('Notes cannot be added to a closed alert; reopen it first');
      const result = await manager.query(
        `INSERT INTO organization_operational_alert_events ("tenantId","organizationId","alertId","actorUserId","eventType","fromStatus","toStatus","note")
         VALUES ($1,$2,$3,$4,'COMMENT',$5,$5,$6)
         RETURNING id,"eventType",note,"createdAt"`,
        [tenantId, organizationId, alertId, actorUserId, rows[0].status, clean],
      );
      await this.tenantAudit.record(manager, { tenantId, actorUserId, action: 'organization.operational_alert.comment', resourceType: 'ORGANIZATION_OPERATIONAL_ALERT', resourceId: alertId, metadata: { organizationId } });
      return result[0];
    });
  }

  async listOperationalAlertHistory(organizationId: string, alertId: string, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const organization = await this.organizations.findOne({ where: { id: organizationId, tenantId, isActive: true } });
    if (!organization) throw new NotFoundException('Organization not found');
    const rows = await this.dataSource.query(
      `SELECT e.id,e."eventType",e."fromStatus",e."toStatus",e.note,e."assignedToUserId",e."createdAt",
              u."firstName" AS "actorFirstName",u."lastName" AS "actorLastName"
         FROM organization_operational_alert_events e
         JOIN organization_operational_alerts a ON a.id=e."alertId" AND a."tenantId"=e."tenantId" AND a."organizationId"=e."organizationId"
         LEFT JOIN users u ON u.id=e."actorUserId"
        WHERE e."tenantId"=$1 AND e."organizationId"=$2 AND e."alertId"=$3
        ORDER BY e."createdAt" DESC LIMIT 200`,
      [tenantId, organizationId, alertId],
    );
    if (!rows.length) {
      const exists = await this.dataSource.query(
        `SELECT 1 FROM organization_operational_alerts WHERE id=$1 AND "tenantId"=$2 AND "organizationId"=$3`,
        [alertId, tenantId, organizationId],
      );
      if (!exists.length) throw new NotFoundException('Operational alert not found');
    }
    return { organizationId, alertId, total: rows.length, items: rows };
  }

  async listOrganizationOperationalAlerts(organizationId: string, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const organization = await this.organizations.findOne({ where: { id: organizationId, tenantId, isActive: true } });
    if (!organization) throw new NotFoundException('Organization not found');

    const rows = await this.dataSource.query(
      `WITH scoped_tasks AS (
         SELECT wt.id, wt.title, wt."dueAt", wt."createdAt"
           FROM workflow_tasks wt
           JOIN process_instances pi ON pi.id = wt."processInstanceId"
          WHERE wt."tenantId" = $1 AND pi."organizationId" = $2
            AND wt.status IN ('OPEN', 'IN_PROGRESS')
       ), alerts AS (
         SELECT 'TASK_UNASSIGNED:' || st.id AS id, 'CRITICAL' AS severity,
                'TASK_UNASSIGNED' AS type, st.title AS title,
                'وظیفهٔ باز فاقد ارجاع‌گیرنده با وضعیت در انتظار اقدام است.' AS description,
                st.id AS "resourceId", st."createdAt" AS "occurredAt", st."dueAt" AS "dueAt"
           FROM scoped_tasks st
          WHERE NOT EXISTS (SELECT 1 FROM task_assignees ta WHERE ta."taskId" = st.id AND ta.status = 'PENDING')
         UNION ALL
         SELECT 'TASK_OVERDUE:' || st.id, 'HIGH', 'TASK_OVERDUE', st.title,
                'مهلت انجام وظیفه سپری شده و وظیفه هنوز باز است.',
                st.id, st."dueAt", st."dueAt"
           FROM scoped_tasks st
          WHERE st."dueAt" IS NOT NULL AND st."dueAt" < now()
         UNION ALL
         SELECT 'ABSENCE_COVERAGE:' || oa.id, 'CRITICAL', 'ABSENCE_COVERAGE_GAP',
                'شکاف پوشش غیبت',
                'غیبت فعال است اما جانشینی متناظر در حال حاضر معتبر و فعال نیست.',
                oa.id, oa."startsAt", oa."endsAt"
           FROM organization_absences oa
           JOIN organization_substitutions os ON os.id = oa."substitutionId"
          WHERE oa."tenantId" = $1 AND oa."organizationId" = $2
            AND oa."cancelledAt" IS NULL AND oa."startsAt" <= now() AND oa."endsAt" > now()
            AND (os."revokedAt" IS NOT NULL OR os."startsAt" > now() OR os."endsAt" <= now())
         UNION ALL
         SELECT 'SUBSTITUTION_ENDING:' || os.id, 'MEDIUM', 'SUBSTITUTION_ENDING',
                'پایان نزدیک جانشینی',
                'جانشینی سازمانی طی ۴۸ ساعت آینده پایان می‌یابد؛ در صورت نیاز، پوشش را تمدید یا جایگزین کنید.',
                os.id, os."startsAt", os."endsAt"
           FROM organization_substitutions os
          WHERE os."tenantId" = $1 AND os."organizationId" = $2
            AND os."revokedAt" IS NULL AND os."startsAt" <= now()
            AND os."endsAt" > now() AND os."endsAt" <= now() + interval '48 hours'
         UNION ALL
         SELECT 'DEFERRAL_PENDING:' || request.id, 'MEDIUM', 'DEFERRAL_REVIEW',
                'درخواست تغییر مهلت در انتظار بررسی',
                'یک درخواست تغییر مهلت برای تصمیم مدیر در انتظار بررسی است.',
                request.id, request."createdAt", request."proposedDueAt"
           FROM task_deferral_requests request
           JOIN scoped_tasks st ON st.id = request."taskId"
          WHERE request."tenantId" = $1 AND request.status = 'PENDING'
       )
       SELECT id, severity, type, title, description, "resourceId", "occurredAt", "dueAt"
         FROM alerts
        ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
                 "occurredAt" ASC NULLS LAST
        LIMIT 100`,
      [tenantId, organizationId],
    );
    for (const row of rows) {
      await this.dataSource.query(
        `INSERT INTO organization_operational_alerts ("tenantId","organizationId","alertKey",type,severity,title,description,"resourceId","dueAt","firstDetectedAt","lastDetectedAt","responseDueAt","resolutionDueAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now(),
           now() + CASE $5 WHEN 'CRITICAL' THEN interval '15 minutes' WHEN 'HIGH' THEN interval '1 hour' ELSE interval '4 hours' END,
           now() + CASE $5 WHEN 'CRITICAL' THEN interval '4 hours' WHEN 'HIGH' THEN interval '8 hours' ELSE interval '24 hours' END)
         ON CONFLICT ("tenantId","organizationId","alertKey") DO UPDATE SET severity=EXCLUDED.severity,title=EXCLUDED.title,description=EXCLUDED.description,"dueAt"=EXCLUDED."dueAt","lastDetectedAt"=now(),status=CASE WHEN organization_operational_alerts.status='RESOLVED' AND organization_operational_alerts."resolutionNote"='__AUTO_RESOLVED__' THEN 'OPEN' ELSE organization_operational_alerts.status END,"resolvedAt"=CASE WHEN organization_operational_alerts."resolutionNote"='__AUTO_RESOLVED__' THEN NULL ELSE organization_operational_alerts."resolvedAt" END,"resolvedByUserId"=CASE WHEN organization_operational_alerts."resolutionNote"='__AUTO_RESOLVED__' THEN NULL ELSE organization_operational_alerts."resolvedByUserId" END,"resolutionNote"=CASE WHEN organization_operational_alerts."resolutionNote"='__AUTO_RESOLVED__' THEN NULL ELSE organization_operational_alerts."resolutionNote" END,"updatedAt"=now()`,
        [tenantId,organizationId,row.id,row.type,row.severity,row.title,row.description,row.resourceId,row.dueAt],
      );
    }
    await this.dataSource.query(
      `UPDATE organization_operational_alerts SET status='RESOLVED',"resolvedAt"=now(),"resolutionNote"='__AUTO_RESOLVED__',"updatedAt"=now()
        WHERE "tenantId"=$1 AND "organizationId"=$2 AND status NOT IN ('RESOLVED','IGNORED') AND "lastDetectedAt" < now()-interval '2 minutes'`,
      [tenantId,organizationId],
    );
    const persisted = await this.dataSource.query(
      `SELECT id,severity,type,title,description,"resourceId","lastDetectedAt" AS "occurredAt","dueAt","responseDueAt","resolutionDueAt",status,"assignedToUserId","acknowledgedAt","resolvedAt","resolutionNote","responseDueAt","resolutionDueAt","escalatedAt","escalationLevel"
         FROM organization_operational_alerts WHERE "tenantId"=$1 AND "organizationId"=$2 AND status NOT IN ('RESOLVED','IGNORED')
         ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,"lastDetectedAt" ASC NULLS LAST LIMIT 100`,
      [tenantId,organizationId],
    );
    const counts = persisted.reduce((result: Record<string, number>, row: any) => {
      result[row.severity] = (result[row.severity] || 0) + 1;
      return result;
    }, {});
    return {
      organizationId,
      generatedAt: new Date().toISOString(),
      total: persisted.length,
      truncated: persisted.length === 100,
      counts: { critical: counts.CRITICAL || 0, high: counts.HIGH || 0, medium: counts.MEDIUM || 0 },
      items: persisted.map((row: any) => ({
        id: row.id, severity: row.severity, type: row.type, title: row.title,
        description: row.description, resourceId: row.resourceId,
        occurredAt: row.occurredAt ? new Date(row.occurredAt).toISOString() : null,
        dueAt: row.dueAt ? new Date(row.dueAt).toISOString() : null,
        status: row.status, assignedToUserId: row.assignedToUserId,
        acknowledgedAt: row.acknowledgedAt ? new Date(row.acknowledgedAt).toISOString() : null,
        resolvedAt: row.resolvedAt ? new Date(row.resolvedAt).toISOString() : null,
        resolutionNote: row.resolutionNote,
        responseDueAt: row.responseDueAt ? new Date(row.responseDueAt).toISOString() : null,
        resolutionDueAt: row.resolutionDueAt ? new Date(row.resolutionDueAt).toISOString() : null,
        escalatedAt: row.escalatedAt ? new Date(row.escalatedAt).toISOString() : null,
        escalationLevel: Number(row.escalationLevel ?? 0),
        slaStatus: row.status === 'RESOLVED' || row.status === 'IGNORED' ? 'CLOSED'
          : row.responseDueAt && new Date(row.responseDueAt) < new Date() && !row.acknowledgedAt ? 'RESPONSE_BREACHED'
          : row.resolutionDueAt && new Date(row.resolutionDueAt) < new Date() ? 'RESOLUTION_BREACHED'
          : row.responseDueAt && new Date(row.responseDueAt).getTime() - Date.now() < 60 * 60 * 1000 ? 'AT_RISK' : 'ON_TRACK',
      })),
    };
  }

  async getOrganizationOperationsOverview(organizationId: string, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const organization = await this.organizations.findOne({ where: { id: organizationId, tenantId, isActive: true } });
    if (!organization) throw new NotFoundException('Organization not found');

    const [metrics] = await this.dataSource.query(
      `WITH active_people AS (
         SELECT DISTINCT u.id
           FROM users u
           JOIN tenant_memberships tm ON tm."userId" = u.id AND tm."tenantId" = $1 AND tm."isActive" = true
           JOIN user_positions up ON up."userId" = u.id AND up."isActive" = true
           JOIN positions p ON p.id = up."positionId" AND p."isActive" = true
           JOIN organization_units ou ON ou.id = p."organizationUnitId" AND ou."organizationId" = $2 AND ou."isActive" = true
          WHERE u."isActive" = true AND up."validFrom" <= now()
            AND (up."validUntil" IS NULL OR up."validUntil" >= now())
       ), scoped_tasks AS (
         SELECT wt.id, wt."dueAt"
           FROM workflow_tasks wt
           JOIN process_instances pi ON pi.id = wt."processInstanceId"
          WHERE wt."tenantId" = $1 AND pi."organizationId" = $2
            AND wt.status IN ('OPEN', 'IN_PROGRESS')
       )
       SELECT
         (SELECT COUNT(*)::int FROM active_people) AS "activeHeadcount",
         (SELECT COUNT(*)::int FROM scoped_tasks) AS "openTasks",
         (SELECT COUNT(*)::int FROM scoped_tasks WHERE "dueAt" < now()) AS "overdueTasks",
         (SELECT COUNT(*)::int FROM scoped_tasks WHERE "dueAt" >= now() AND "dueAt" < now() + interval '7 days') AS "dueNext7Days",
         (SELECT COUNT(*)::int FROM scoped_tasks st
           WHERE NOT EXISTS (SELECT 1 FROM task_assignees ta WHERE ta."taskId" = st.id AND ta.status = 'PENDING')) AS "tasksWithoutPendingAssignee",
         (SELECT COUNT(DISTINCT oa.id)::int FROM organization_absences oa
           WHERE oa."tenantId" = $1 AND oa."organizationId" = $2 AND oa."cancelledAt" IS NULL
             AND oa."startsAt" <= now() AND oa."endsAt" > now()) AS "activeAbsences",
         (SELECT COUNT(DISTINCT oa.id)::int FROM organization_absences oa
           WHERE oa."tenantId" = $1 AND oa."organizationId" = $2 AND oa."cancelledAt" IS NULL
             AND oa."startsAt" > now() AND oa."startsAt" < now() + interval '30 days') AS "upcomingAbsences30Days",
         (SELECT COUNT(DISTINCT td.id)::int FROM task_delegations td
           JOIN scoped_tasks st ON st.id = td."taskId"
          WHERE td."tenantId" = $1 AND td."revokedAt" IS NULL AND td."startsAt" <= now() AND td."endsAt" > now()) AS "activeTaskDelegations",
         (SELECT COUNT(DISTINCT os.id)::int FROM organization_substitutions os
           WHERE os."tenantId" = $1 AND os."organizationId" = $2 AND os."revokedAt" IS NULL
             AND os."startsAt" <= now() AND os."endsAt" > now()) AS "activeSubstitutions"`,
      [tenantId, organizationId],
    );

    const workload = await this.getOrganizationWorkload(organizationId, tenantId);
    const cap = workload.policy.maxOpenTasksPerSubstitute;
    const warningAt = Math.ceil(cap * workload.policy.warningThresholdPercent / 100);
    const highLoad = workload.items
      .map((person: any) => ({
        userId: person.userId,
        firstName: person.firstName,
        lastName: person.lastName,
        openTaskCount: person.openTaskCount,
        projectedLoad: person.openTaskCount + person.prospectiveCoverageCount,
        atCapacity: person.openTaskCount + person.prospectiveCoverageCount >= cap,
        nearCapacity: person.openTaskCount + person.prospectiveCoverageCount >= warningAt,
      }))
      .filter((person: any) => person.nearCapacity)
      .sort((a: any, b: any) => b.projectedLoad - a.projectedLoad)
      .slice(0, 10);

    return {
      organizationId,
      generatedAt: new Date().toISOString(),
      metrics: {
        activeHeadcount: Number(metrics.activeHeadcount ?? 0),
        openTasks: Number(metrics.openTasks ?? 0),
        overdueTasks: Number(metrics.overdueTasks ?? 0),
        dueNext7Days: Number(metrics.dueNext7Days ?? 0),
        tasksWithoutPendingAssignee: Number(metrics.tasksWithoutPendingAssignee ?? 0),
        activeAbsences: Number(metrics.activeAbsences ?? 0),
        upcomingAbsences30Days: Number(metrics.upcomingAbsences30Days ?? 0),
        activeSubstitutions: Number(metrics.activeSubstitutions ?? 0),
        activeTaskDelegations: Number(metrics.activeTaskDelegations ?? 0),
        employeesNearCapacity: highLoad.length,
        employeesAtCapacity: highLoad.filter((person: any) => person.atCapacity).length,
      },
      workloadPolicy: workload.policy,
      employeesNearCapacity: highLoad,
    };
  }

  async listOrganizationAbsences(
    organizationId: string, tenantId?: string | null, limitValue?: string, offsetValue?: string,
    fromValue?: string, toValue?: string, statusValue?: string,
  ) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const limit = limitValue === undefined ? 25 : Number(limitValue);
    const offset = offsetValue === undefined ? 0 : Number(offsetValue);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('limit must be between 1 and 100');
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000000) throw new BadRequestException('offset must be between 0 and 1000000');
    if ((fromValue && !toValue) || (!fromValue && toValue)) throw new BadRequestException('from and to must be provided together');
    let from: Date | undefined;
    let to: Date | undefined;
    if (fromValue && toValue) {
      from = new Date(fromValue);
      to = new Date(toValue);
      if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
        throw new BadRequestException('A valid date range with from earlier than to is required');
      }
      if (to.getTime() - from.getTime() > 93 * 24 * 60 * 60 * 1000) {
        throw new BadRequestException('Date range cannot exceed 93 days');
      }
    }
    const status = statusValue || 'ALL';
    if (!['ALL', 'ACTIVE', 'UPCOMING', 'EXPIRED', 'CANCELLED'].includes(status)) {
      throw new BadRequestException('status must be ALL, ACTIVE, UPCOMING, EXPIRED or CANCELLED');
    }
    const organization = await this.organizations.findOne({ where: { id: organizationId, tenantId, isActive: true } });
    if (!organization) throw new NotFoundException('Organization not found');

    const repository = this.dataSource.getRepository(OrganizationAbsence);
    const applyScope = (qb: ReturnType<typeof repository.createQueryBuilder>) => {
      qb.where('absence."tenantId" = :tenantId AND absence."organizationId" = :organizationId', { tenantId, organizationId });
      if (from && to) qb.andWhere('absence."startsAt" < :to AND absence."endsAt" > :from', { from, to });
      if (status === 'CANCELLED') qb.andWhere('absence."cancelledAt" IS NOT NULL');
      if (status === 'ACTIVE') qb.andWhere('absence."cancelledAt" IS NULL AND absence."startsAt" <= CURRENT_TIMESTAMP AND absence."endsAt" > CURRENT_TIMESTAMP');
      if (status === 'UPCOMING') qb.andWhere('absence."cancelledAt" IS NULL AND absence."startsAt" > CURRENT_TIMESTAMP');
      if (status === 'EXPIRED') qb.andWhere('absence."cancelledAt" IS NULL AND absence."endsAt" <= CURRENT_TIMESTAMP');
      return qb;
    };
    const itemsQuery = applyScope(repository.createQueryBuilder('absence'))
      .orderBy('absence."createdAt"', 'DESC')
      .addOrderBy('absence.id', 'DESC')
      .take(limit).skip(offset);
    const countQuery = applyScope(repository.createQueryBuilder('absence'));
    const [items, total] = await Promise.all([itemsQuery.getMany(), countQuery.getCount()]);

    const summaryQuery = repository.createQueryBuilder('absence')
      .select('COUNT(*)', 'total')
      .addSelect('COUNT(*) FILTER (WHERE absence."cancelledAt" IS NOT NULL)', 'cancelled')
      .addSelect('COUNT(*) FILTER (WHERE absence."cancelledAt" IS NULL AND absence."startsAt" <= CURRENT_TIMESTAMP AND absence."endsAt" > CURRENT_TIMESTAMP)', 'active')
      .addSelect('COUNT(*) FILTER (WHERE absence."cancelledAt" IS NULL AND absence."startsAt" > CURRENT_TIMESTAMP)', 'upcoming')
      .addSelect('COUNT(*) FILTER (WHERE absence."cancelledAt" IS NULL AND absence."endsAt" <= CURRENT_TIMESTAMP)', 'expired')
      .where('absence."tenantId" = :tenantId AND absence."organizationId" = :organizationId', { tenantId, organizationId });
    const summaryRaw = await summaryQuery.getRawOne();
    const summary = {
      total: Number(summaryRaw?.total ?? 0),
      active: Number(summaryRaw?.active ?? 0),
      upcoming: Number(summaryRaw?.upcoming ?? 0),
      expired: Number(summaryRaw?.expired ?? 0),
      cancelled: Number(summaryRaw?.cancelled ?? 0),
    };
    return { items, total, limit, offset, status, summary, range: from && to ? { from: from.toISOString(), to: to.toISOString() } : null };
  }

  async cancelOrganizationAbsence(organizationId: string, absenceId: string, actorUserId: string, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    return this.dataSource.transaction(async manager => {
      const absence = await manager.findOne(OrganizationAbsence, {
        where: { id: absenceId, tenantId, organizationId }, lock: { mode: 'pessimistic_write' },
      });
      if (!absence) throw new NotFoundException('Absence not found');
      if (absence.cancelledAt) throw new ConflictException('Absence is already cancelled');
      absence.cancelledAt = new Date();
      absence.cancelledByUserId = actorUserId;
      await manager.save(absence);
      const substitution = await manager.findOne(OrganizationSubstitution, {
        where: { id: absence.substitutionId, tenantId, organizationId }, lock: { mode: 'pessimistic_write' },
      });
      if (substitution && !substitution.revokedAt) {
        substitution.revokedAt = absence.cancelledAt;
        substitution.revokedByUserId = actorUserId;
        await manager.save(substitution);
      }
      await this.tenantAudit.record(manager, {
        tenantId, actorUserId, targetUserId: absence.userId, action: 'workflow.organization_absence.cancelled',
        resourceType: 'ORG_ABSENCE', resourceId: absence.id,
        metadata: { organizationId, substituteUserId: absence.substituteUserId, substitutionId: absence.substitutionId },
      });
      return absence;
    });
  }

  async requestTaskDeferral(taskId: string, requesterId: string, dto: RequestTaskDeferralDto, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const proposedDueAt = new Date(dto.proposedDueAt);
    const now = new Date();
    if (!Number.isFinite(proposedDueAt.getTime()) || proposedDueAt <= now) {
      throw new BadRequestException('Proposed deadline must be in the future');
    }
    const reason = dto.reason.trim();
    if (reason.length < 5 || reason.length > 1000) throw new BadRequestException('A reason between 5 and 1000 characters is required');

    return this.dataSource.transaction(async manager => {
      const task = await manager.findOne(WorkflowTask, {
        where: { id: taskId }, relations: { processInstance: { organization: true } },
        lock: { mode: 'pessimistic_write' },
      });
      if (!task || task.processInstance.organization?.tenantId !== tenantId) throw new NotFoundException('Task not found');
      if (!['OPEN', 'IN_PROGRESS'].includes(task.status)) throw new ConflictException('Only open tasks can be deferred');
      const direct = await manager.getRepository(TaskAssignee).exist({ where: { taskId, userId: requesterId, status: 'PENDING' } });
      const delegated = await manager.createQueryBuilder(TaskDelegation, 'delegation')
        .where('delegation.taskId = :taskId AND delegation.tenantId = :tenantId', { taskId, tenantId })
        .andWhere('delegation.toUserId = :requesterId AND delegation."revokedAt" IS NULL', { requesterId })
        .andWhere('delegation."startsAt" <= :now AND delegation."endsAt" > :now', { now })
        .andWhere(`EXISTS (SELECT 1 FROM task_assignees a WHERE a."taskId" = delegation."taskId" AND a."userId" = delegation."fromUserId" AND a.status = 'PENDING')`)
        .getCount() > 0;
      if (!direct && !delegated) throw new ForbiddenException('Only a pending assignee or active delegate may request a deadline change');

      const baseline = task.dueAt && task.dueAt > now ? task.dueAt : now;
      if (proposedDueAt <= baseline || proposedDueAt.getTime() - baseline.getTime() > 30 * 86400000) {
        throw new BadRequestException('A deferral may extend the current deadline by no more than 30 days');
      }
      const pending = await manager.findOne(TaskDeferralRequest, {
        where: { taskId, tenantId, status: 'PENDING' }, lock: { mode: 'pessimistic_write' },
      });
      if (pending) throw new ConflictException('A pending deadline change request already exists for this task');

      const request = await manager.save(TaskDeferralRequest, manager.create(TaskDeferralRequest, {
        tenantId, taskId, requesterUserId: requesterId, originalDueAt: task.dueAt,
        proposedDueAt, reason, status: 'PENDING',
      }));
      await this.tenantAudit.record(manager, {
        tenantId, actorUserId: requesterId, action: 'workflow.task.deferral_requested',
        resourceType: 'TASK_DEFERRAL', resourceId: request.id,
        metadata: { taskId, originalDueAt: task.dueAt?.toISOString() ?? null, proposedDueAt: proposedDueAt.toISOString(), reason },
      });
      return request;
    });
  }


  async listPendingTaskDeferrals(organizationId: string, tenantId?: string | null, requestedLimit?: string, requestedOffset?: string) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    if (!organizationId) throw new BadRequestException('organizationId is required');
    const limit = requestedLimit === undefined ? 50 : Number(requestedLimit);
    const offset = requestedOffset === undefined ? 0 : Number(requestedOffset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('limit must be an integer between 1 and 100');
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000) throw new BadRequestException('offset must be a non-negative integer no greater than 100000');
    const organization = await this.organizations.findOne({ where: { id: organizationId, isActive: true } });
    if (!organization || organization.tenantId !== tenantId) throw new NotFoundException('Organization not found');
    return this.dataSource.getRepository(TaskDeferralRequest).createQueryBuilder('request')
      .innerJoin('workflow_tasks', 'task', 'task.id = request."taskId"')
      .innerJoin('process_instances', 'instance', 'instance.id = task."processInstanceId"')
      .where('request."tenantId" = :tenantId AND request.status = :status', { tenantId, status: 'PENDING' })
      .andWhere('instance."organizationId" = :organizationId', { organizationId })
      .orderBy('request."createdAt"', 'ASC')
      .take(limit).skip(offset)
      .getManyAndCount()
      .then(([items, total]) => ({ items, total, limit, offset }));
  }

  async listTaskDeferrals(taskId: string, requesterId: string, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const task = await this.tasks.findOne({ where: { id: taskId }, relations: { processInstance: { organization: true } } });
    if (!task || task.processInstance.organization?.tenantId !== tenantId) throw new NotFoundException('Task not found');
    const [assigned, started, delegated] = await Promise.all([
      this.assignees.exist({ where: { taskId, userId: requesterId } }),
      this.instances.exist({ where: { id: task.processInstanceId, startedByUserId: requesterId } }),
      this.dataSource.getRepository(TaskDelegation).exist({ where: { taskId, tenantId, toUserId: requesterId } }),
    ]);
    if (!assigned && !started && !delegated) throw new ForbiddenException('You are not allowed to view task deadline requests');
    return this.dataSource.getRepository(TaskDeferralRequest).find({
      where: { taskId, tenantId }, order: { createdAt: 'DESC' },
    });
  }

  async reviewTaskDeferral(taskId: string, requestId: string, reviewerId: string, decision: 'APPROVED' | 'REJECTED', dto?: ReviewTaskDeferralDto, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    return this.dataSource.transaction(async manager => {
      const task = await manager.findOne(WorkflowTask, {
        where: { id: taskId }, relations: { processInstance: { organization: true } },
        lock: { mode: 'pessimistic_write' },
      });
      if (!task || task.processInstance.organization?.tenantId !== tenantId) throw new NotFoundException('Task not found');
      const reviewerMembership = await manager.query(
        'SELECT 1 FROM tenant_memberships tm INNER JOIN users u ON u.id = tm."userId" AND u."isActive" = true WHERE tm."tenantId" = $1 AND tm."userId" = $2 AND tm."isActive" = true LIMIT 1',
        [tenantId, reviewerId],
      );
      if (!reviewerMembership.length) throw new ForbiddenException('Only an active member of this tenant may review deadline requests');
      const request = await manager.findOne(TaskDeferralRequest, {
        where: { id: requestId, taskId, tenantId }, lock: { mode: 'pessimistic_write' },
      });
      if (!request) throw new NotFoundException('Deadline change request not found');
      if (request.requesterUserId === reviewerId) throw new ForbiddenException('A requester cannot review their own deadline change request');
      if (request.status !== 'PENDING') throw new ConflictException('Deadline change request has already been reviewed');
      const previousDueAt = task.dueAt;
      if (decision === 'APPROVED') {
        if (!['OPEN', 'IN_PROGRESS'].includes(task.status)) throw new ConflictException('Closed tasks cannot have their deadline changed');
        const currentDueAt = previousDueAt?.getTime() ?? null;
        const requestedOriginalDueAt = request.originalDueAt?.getTime() ?? null;
        if (currentDueAt !== requestedOriginalDueAt) throw new ConflictException('Task deadline changed after this request was submitted; reject the stale request');
        if (request.proposedDueAt <= new Date()) throw new ConflictException('The proposed deadline has already passed; reject the stale request');
        task.dueAt = request.proposedDueAt;
        await manager.save(task);
      }
      request.status = decision;
      request.reviewerUserId = reviewerId;
      request.reviewedAt = new Date();
      request.reviewerComment = dto?.comment?.trim() || null;
      await manager.save(request);
      await this.tenantAudit.record(manager, {
        tenantId, actorUserId: reviewerId, targetUserId: request.requesterUserId,
        action: decision === 'APPROVED' ? 'workflow.task.deferral_approved' : 'workflow.task.deferral_rejected',
        resourceType: 'TASK_DEFERRAL', resourceId: request.id,
        metadata: { taskId, previousDueAt: previousDueAt?.toISOString() ?? null, effectiveDueAt: decision === 'APPROVED' ? request.proposedDueAt.toISOString() : previousDueAt?.toISOString() ?? null, proposedDueAt: request.proposedDueAt.toISOString(), comment: request.reviewerComment },
      });
      return request;
    });
  }


  async listTaskReassignments(taskId: string, requesterId: string, tenantId?: string | null) {
    await this.taskHistory(taskId, requesterId, tenantId);
    return this.dataSource.getRepository(WorkflowTaskReassignment).find({
      where: { taskId, tenantId: tenantId! }, order: { createdAt: 'ASC' },
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
    const substituted = task ? await this.dataSource.getRepository(OrganizationSubstitution).createQueryBuilder('s')
      .innerJoin(TaskAssignee, 'original', 'original.taskId = :taskId AND original.userId = s.originalUserId', { taskId })
      .where('s.tenantId = :tenantId AND s.organizationId = :organizationId AND s.substituteUserId = :requesterId', {
        tenantId, organizationId: task.processInstance.organizationId, requesterId,
      }).getCount() > 0 : false;
    if (!task || (!assigned && !delegated && !substituted && task.processInstance.startedByUserId !== requesterId)) throw new ForbiddenException('You are not allowed to view this task history');
    return this.dataSource.getRepository(WorkflowActionLog).find({ where: { taskId }, relations: { user: true }, order: { createdAt: 'ASC' } });
  }
}