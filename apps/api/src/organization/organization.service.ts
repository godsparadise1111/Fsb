import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from './entities/organization.entity';
import { OrganizationUnit } from './entities/organization-unit.entity';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { CreateUnitDto } from './dto/create-unit.dto';
@Injectable()
export class OrganizationService {
  constructor(
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    @InjectRepository(OrganizationUnit) private readonly units: Repository<OrganizationUnit>,
  ) {}
  async createOrganization(dto: CreateOrganizationDto) {
    if (await this.organizations.findOne({ where: { code: dto.code } })) throw new ConflictException('Organization code already exists');
    return this.organizations.save(this.organizations.create(dto));
  }
  listOrganizations() { return this.organizations.find({ where: { isActive: true }, order: { name: 'ASC' } }); }
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
}
