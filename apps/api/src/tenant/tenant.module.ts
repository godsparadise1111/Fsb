import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './entities/tenant.entity';
import { TenantMembership } from './entities/tenant-membership.entity';
import { TenantInvitation } from './entities/tenant-invitation.entity';
import { User } from '../identity/entities/user.entity';
import { TenantController } from './tenant.controller';
import { TenantMembershipController } from './tenant-membership.controller';
import { TenantSelfServiceController } from './tenant-self-service.controller';
import { TenantService } from './tenant.service';
import { TenantMembershipService } from './tenant-membership.service';
import { TenantInvitationController } from './tenant-invitation.controller';
import { TenantInvitationService } from './tenant-invitation.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { TenantAuditLog } from './entities/tenant-audit-log.entity';
import { TenantAuditService } from './tenant-audit.service';
import { TenantAuditController } from './tenant-audit.controller';
import { TenantUsageService } from './tenant-usage.service';
import { TenantUsageController } from './tenant-usage.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, TenantMembership, TenantInvitation, TenantAuditLog, User]), NotificationsModule],
  controllers: [TenantController, TenantMembershipController, TenantSelfServiceController, TenantInvitationController, TenantAuditController, TenantUsageController],
  providers: [TenantService, TenantMembershipService, TenantInvitationService, TenantAuditService, TenantUsageService],
  exports: [TenantService, TenantMembershipService, TenantInvitationService, TenantAuditService],
})
export class TenantModule {}