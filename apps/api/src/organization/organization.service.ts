import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from './entities/organization.entity';
import { OrganizationUnit } from './entities/organization-unit.entity';
import { Position } from './entities/position.entity';
import { Tenant } from '../tenant/entities/tenant.entity';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { CreateUnitDto } from './dto/create-unit.dto';
import { CreatePositionDto } from './dto/create-position.dto';
@Injectable()
export class OrganizationService {
  constructor(@InjectRepository(Organization) private readonly organizations: Repository<Organization>, @InjectRepository(OrganizationUnit) private readonly units: Repository<OrganizationUnit>, @InjectRepository(Position) private readonly positions: Repository<Position>, @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>) {}
  async createOrganization(dto: CreateOrganizationDto) {
    if (!dto.tenantId) throw new BadRequestException('A tenant must be explicitly selected or derived from the authenticated tenant context');
    const tenant = await this.tenants.findOne({ where: { id: dto.tenantId } });
    if (!tenant || tenant.status !== 'ACTIVE') throw new BadRequestException('Organization can only be created for an active tenant');
    if (await this.organizations.findOne({ where: { code: dto.code } })) throw new ConflictException('Organization code already exists');
    return this.organizations.save(this.organizations.create({ ...dto, tenant }));
  }
  listOrganizations(tenantId?: string | null) { return this.organizations.find({ where: tenantId ? { tenantId, isActive: true } : { isActive: true }, order: { name: 'ASC' } }); }
  async createUnit(dto: CreateUnitDto) {
    const organization = await this.organizations.findOne({ where: { id: dto.organizationId, isActive: true } });
    if (!organization) throw new NotFoundException('Organization not found');
    if (dto.parentId) {
      const parent = await this.units.findOne({ where: { id: dto.parentId, organizationId: dto.organizationId, isActive: true } });
      if (!parent) throw new BadRequestException('Parent unit must belong to the same organization');
    }
    if (await this.units.findOne({ where: { organizationId: dto.organizationId, parentId: dto.parentId ?? null, code: dto.code } })) throw new ConflictException('Unit code already exists under this parent');
    return this.units.save(this.units.create({ ...dto, parentId: dto.parentId ?? null }));
  }
  async listUnits(organizationId: string) {
    if (!await this.organizations.exist({ where: { id: organizationId } })) throw new NotFoundException('Organization not found');
    return this.units.find({ where: { organizationId }, relations: { parent: true }, order: { name: 'ASC' } });
  }
  async createPosition(dto: CreatePositionDto) {
    const unit = await this.units.findOne({ where: { id: dto.organizationUnitId, isActive: true } });
    if (!unit) throw new NotFoundException('Organization unit not found');
    if (await this.positions.findOne({ where: { organizationUnitId: dto.organizationUnitId, code: dto.code } })) throw new ConflictException('Position code already exists in this unit');
    return this.positions.save(this.positions.create(dto));
  }
  async listPositions(unitId: string) {
    if (!await this.units.exist({ where: { id: unitId } })) throw new NotFoundException('Organization unit not found');
    return this.positions.find({ where: { organizationUnitId: unitId, isActive: true }, order: { title: 'ASC' } });
  }
}
