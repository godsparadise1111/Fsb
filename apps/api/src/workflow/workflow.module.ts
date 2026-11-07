import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProcessVersion } from '../process/entities/process-version.entity';
import { Organization } from '../organization/entities/organization.entity';
import { User } from '../identity/entities/user.entity';
import { ProcessInstance } from './entities/process-instance.entity';
import { WorkflowTask } from './entities/workflow-task.entity';
import { TaskAssignee } from './entities/task-assignee.entity';
import { WorkflowActionLog } from './entities/workflow-action-log.entity';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { TaskDelegation } from './entities/task-delegation.entity';
import { TaskDeferralRequest } from './entities/task-deferral-request.entity';
import { OrganizationSubstitution } from './entities/organization-substitution.entity';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [TypeOrmModule.forFeature([ProcessVersion, Organization, User, ProcessInstance, WorkflowTask, TaskAssignee, WorkflowActionLog, TaskDelegation, TaskDeferralRequest, OrganizationSubstitution]), TenantModule],
  controllers: [WorkflowController],
  providers: [WorkflowService],
})
export class WorkflowModule {}