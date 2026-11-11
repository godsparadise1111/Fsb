import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from './entities/organization.entity';
import { OrganizationUnit } from './entities/organization-unit.entity';
import { Position } from './entities/position.entity';
import { Tenant } from '../tenant/entities/tenant.entity';
import { UserRole } from '../identity/entities/user-role.entity';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { TenantModule } from '../tenant/tenant.module';
@Module({ imports: [TypeOrmModule.forFeature([Organization, OrganizationUnit, Position, Tenant, UserRole]), TenantModule], controllers: [OrganizationController], providers: [OrganizationService] })
export class OrganizationModule {}
