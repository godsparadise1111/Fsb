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

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, TenantMembership, TenantInvitation, User])],
  controllers: [TenantController, TenantMembershipController, TenantSelfServiceController, TenantInvitationController],
  providers: [TenantService, TenantMembershipService, TenantInvitationService],
  exports: [TenantService, TenantMembershipService, TenantInvitationService],
})
export class TenantModule {}