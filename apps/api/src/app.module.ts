import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule } from './health/health.module';
import { OrganizationModule } from './organization/organization.module';
import { IdentityModule } from './identity/identity.module';
import { ProcessModule } from './process/process.module';
import { WorkflowModule } from './workflow/workflow.module';
import { FormsModule } from './forms/forms.module';
import { AuthModule } from './auth/auth.module';
import { TenantModule } from './tenant/tenant.module';
import { Tenant } from './tenant/entities/tenant.entity';
import { TenantMembership } from './tenant/entities/tenant-membership.entity';
import { TenantInvitation } from './tenant/entities/tenant-invitation.entity';
import { Organization } from './organization/entities/organization.entity';
import { OrganizationUnit } from './organization/entities/organization-unit.entity';
import { Position } from './organization/entities/position.entity';
import { User } from './identity/entities/user.entity';
import { UserPosition } from './identity/entities/user-position.entity';
import { Role } from './identity/entities/role.entity';
import { Permission } from './identity/entities/permission.entity';
import { UserRole } from './identity/entities/user-role.entity';
import { ProcessDefinition } from './process/entities/process-definition.entity';
import { ProcessVersion } from './process/entities/process-version.entity';
import { ProcessInstance } from './workflow/entities/process-instance.entity';
import { WorkflowTask } from './workflow/entities/workflow-task.entity';
import { TaskAssignee } from './workflow/entities/task-assignee.entity';
import { WorkflowActionLog } from './workflow/entities/workflow-action-log.entity';
import { FormDefinition } from './forms/entities/form-definition.entity';
import { FormVersion } from './forms/entities/form-version.entity';
import { FormSubmission } from './forms/entities/form-submission.entity';
import { FileAttachment } from './forms/entities/file-attachment.entity';
import { NotificationOutbox } from './notifications/entities/notification-outbox.entity';
import { TenantAuditLog } from './tenant/entities/tenant-audit-log.entity';

if (process.env.NODE_ENV === 'production' && process.env.DB_SYNCHRONIZE === 'true') {
  throw new Error('DB_SYNCHRONIZE=true is forbidden in production; use versioned SQL migrations.');
}

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.POSTGRES_USER ?? 'fsb',
      password: process.env.POSTGRES_PASSWORD ?? 'change_me_locally',
      database: process.env.POSTGRES_DB ?? 'fsb',
      entities: [TenantAuditLog, NotificationOutbox, Tenant, TenantMembership, TenantInvitation, Organization, OrganizationUnit, Position, User, UserPosition, Role, Permission, UserRole, ProcessDefinition, ProcessVersion, ProcessInstance, WorkflowTask, TaskAssignee, WorkflowActionLog, FormDefinition, FormVersion, FormSubmission, FileAttachment],
      synchronize: process.env.NODE_ENV !== 'production' && process.env.DB_SYNCHRONIZE === 'true',
      autoLoadEntities: true,
    }),
    HealthModule, OrganizationModule, IdentityModule, ProcessModule, WorkflowModule, FormsModule, AuthModule, TenantModule,
  ],
})
export class AppModule {}