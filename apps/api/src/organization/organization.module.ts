import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from './entities/organization.entity';
import { OrganizationUnit } from './entities/organization-unit.entity';
import { Position } from './entities/position.entity';
import { Tenant } from '../tenant/entities/tenant.entity';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
@Module({ imports: [TypeOrmModule.forFeature([Organization, OrganizationUnit, Position, Tenant])], controllers: [OrganizationController], providers: [OrganizationService] })
export class OrganizationModule {}
