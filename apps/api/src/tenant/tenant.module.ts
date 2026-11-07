import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './entities/tenant.entity';
import { TenantMembership } from './entities/tenant-membership.entity';
import { User } from '../identity/entities/user.entity';
import { TenantController } from './tenant.controller';
import { TenantMembershipController } from './tenant-membership.controller';
import { TenantSelfServiceController } from './tenant-self-service.controller';
import { TenantService } from './tenant.service';
import { TenantMembershipService } from './tenant-membership.service';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, TenantMembership, User])],
  controllers: [TenantController, TenantMembershipController, TenantSelfServiceController],
  providers: [TenantService, TenantMembershipService],
  exports: [TenantService, TenantMembershipService],
})
export class TenantModule {}