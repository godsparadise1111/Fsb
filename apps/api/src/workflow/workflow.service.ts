import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ProcessVersion } from '../process/entities/process-version.entity';
import { Organization } from '../organization/entities/organization.entity';
import { User } from '../identity/entities/user.entity';
import { ProcessInstance } from './entities/process-instance.entity';
import { WorkflowTask } from './entities/workflow-task.entity';
import { TaskAssignee } from './entities/task-assignee.entity';
import { WorkflowActionLog } from './entities/workflow-action-log.entity';
import { StartProcessDto } from './dto/start-process.dto';
import { ActTaskDto } from './dto/act-task.dto';

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
  ) {}

  async startProcess(dto: StartProcessDto) {
    return this.dataSource.transaction(async manager => {
      const version = await manager.findOne(ProcessVersion, { where: { id: dto.processVersionId, status: 'PUBLISHED' }, relations: { definition: true } });
      if (!version) throw new NotFoundException('Published process version not found');
      if (version.definition.organizationId !== dto.organizationId) throw new BadRequestException('Process version does not belong to the selected organization');
      if (!await manager.getRepository(Organization).exist({ where: { id: dto.organizationId, isActive: true } })) throw new NotFoundException('Active organization not found');
      const uniqueIds = [...new Set(dto.initialAssigneeUserIds)];
      const users = await manager.find(User, { where: { id: In(uniqueIds), isActive: true } });
      if (users.length !== uniqueIds.length) throw new BadRequestException('Every assignee must be an active user');
      if (!users.some(user => user.id === dto.startedByUserId)) throw new BadRequestException('The starter must be an active user');
      const instance = await manager.save(ProcessInstance, manager.create(ProcessInstance, {
        processVersionId: version.id, organizationId: dto.organizationId, startedByUserId: dto.startedByUserId,
        title: dto.title, data: dto.data ?? {}, status: 'RUNNING',
      }));
      const task = await manager.save(WorkflowTask, manager.create(WorkflowTask, {
        processInstanceId: instance.id, title: dto.firstTaskTitle ?? 'بررسی و اقدام اولیه',
        assignmentPolicy: dto.assignmentPolicy ?? 'ALL_ASSIGNEES', status: 'OPEN', createdByUserId: dto.startedByUserId,
      }));
      await manager.save(TaskAssignee, uniqueIds.map(userId => manager.create(TaskAssignee, { taskId: task.id, userId, status: 'PENDING' })));
      return manager.findOne(WorkflowTask, { where: { id: task.id }, relations: { assignees: { user: true }, processInstance: true } });
    });
  }

  listMyTasks(userId: string) {
    return this.tasks.createQueryBuilder('task')
      .innerJoin('task.assignees', 'assignment', 'assignment.userId = :userId', { userId })
      .leftJoinAndSelect('task.processInstance', 'instance')
      .leftJoinAndSelect('task.assignees', 'assignees')
      .where('task.status IN (:...statuses)', { statuses: ['OPEN', 'IN_PROGRESS'] })
      .orderBy('task.createdAt', 'ASC').getMany();
  }

  async act(taskId: string, dto: ActTaskDto) {
    return this.dataSource.transaction(async manager => {
      const task = await manager.findOne(WorkflowTask, { where: { id: taskId }, lock: { mode: 'pessimistic_write' } });
      if (!task) throw new NotFoundException('Task not found');
      if (!['OPEN', 'IN_PROGRESS'].includes(task.status)) throw new ConflictException('Task is no longer actionable');
      const assignment = await manager.findOne(TaskAssignee, { where: { taskId, userId: dto.userId }, lock: { mode: 'pessimistic_write' } });
      if (!assignment) throw new BadRequestException('User is not assigned to this task');
      if (assignment.status !== 'PENDING') throw new ConflictException('This user has already acted on the task');
      assignment.status = dto.action;
      assignment.comment = dto.comment ?? null;
      assignment.actedAt = new Date();
      await manager.save(assignment);
      await manager.save(WorkflowActionLog, manager.create(WorkflowActionLog, { taskId, userId: dto.userId, action: dto.action, comment: dto.comment ?? null }));
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
        const instance = await manager.findOneByOrFail(ProcessInstance, { id: task.processInstanceId });
        instance.status = 'COMPLETED';
        instance.completedAt = new Date();
        await manager.save(instance);
      } else {
        task.status = 'IN_PROGRESS';
      }
      await manager.save(task);
      return manager.findOne(WorkflowTask, { where: { id: taskId }, relations: { assignees: true, processInstance: true } });
    });
  }

  async taskHistory(taskId: string) {
    if (!await this.tasks.exist({ where: { id: taskId } })) throw new NotFoundException('Task not found');
    return this.dataSource.getRepository(WorkflowActionLog).find({ where: { taskId }, relations: { user: true }, order: { createdAt: 'ASC' } });
  }
}