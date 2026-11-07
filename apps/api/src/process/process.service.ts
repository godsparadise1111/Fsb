import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Organization } from '../organization/entities/organization.entity';
import { ProcessDefinition } from './entities/process-definition.entity';
import { ProcessVersion } from './entities/process-version.entity';
import { CreateProcessDto } from './dto/create-process.dto';
import { CreateProcessVersionDto } from './dto/create-process-version.dto';

@Injectable()
export class ProcessService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ProcessDefinition) private readonly definitions: Repository<ProcessDefinition>,
    @InjectRepository(ProcessVersion) private readonly versions: Repository<ProcessVersion>,
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
  ) {}
  async createDefinition(dto: CreateProcessDto) {
    const organization = await this.organizations.findOne({ where: { id: dto.organizationId, isActive: true }, relations: { tenant: true } });
    if (!organization) throw new NotFoundException('Active organization not found');
    if (!organization.tenant || organization.tenant.status !== 'ACTIVE') throw new BadRequestException('The organization customer account is not active');
    if (await this.definitions.findOneBy({ organizationId: dto.organizationId, code: dto.code })) throw new ConflictException('Process code already exists in this organization');
    return this.definitions.save(this.definitions.create({ ...dto, status: 'DRAFT' }));
  }
  listDefinitions(organizationId?: string, tenantId?: string | null) {
    const query = this.definitions.createQueryBuilder('definition')
      .innerJoinAndSelect('definition.organization', 'organization')
      .orderBy('definition.name', 'ASC');
    if (organizationId) query.andWhere('definition.organizationId = :organizationId', { organizationId });
    else if (tenantId) query.andWhere('organization.tenantId = :tenantId', { tenantId });
    return query.getMany();
  }
  async createVersion(definitionId: string, dto: CreateProcessVersionDto) {
    return this.dataSource.transaction(async manager => {
      const definition = await manager.findOne(ProcessDefinition, { where: { id: definitionId }, lock: { mode: 'pessimistic_write' } });
      if (!definition) throw new NotFoundException('Process definition not found');
      if (definition.status === 'ARCHIVED') throw new BadRequestException('Archived process cannot be changed');
      const latest = await manager.findOne(ProcessVersion, { where: { definitionId }, order: { versionNumber: 'DESC' } });
      return manager.save(ProcessVersion, manager.create(ProcessVersion, {
        definitionId, versionNumber: (latest?.versionNumber ?? 0) + 1, status: 'DRAFT',
        schema: dto.schema, changeNote: dto.changeNote ?? null,
      }));
    });
  }
  async listVersions(definitionId: string) {
    if (!await this.definitions.exist({ where: { id: definitionId } })) throw new NotFoundException('Process definition not found');
    return this.versions.find({ where: { definitionId }, order: { versionNumber: 'DESC' } });
  }
  async publishVersion(definitionId: string, versionId: string) {
    return this.dataSource.transaction(async manager => {
      const definition = await manager.findOne(ProcessDefinition, { where: { id: definitionId }, lock: { mode: 'pessimistic_write' } });
      if (!definition) throw new NotFoundException('Process definition not found');
      if (definition.status === 'ARCHIVED') throw new BadRequestException('Archived process cannot be published');
      const version = await manager.findOne(ProcessVersion, { where: { id: versionId, definitionId }, lock: { mode: 'pessimistic_write' } });
      if (!version) throw new NotFoundException('Process version not found');
      if (version.status !== 'DRAFT') throw new BadRequestException('Only draft versions can be published');
      const configuredSteps = version.schema?.steps;
      if (configuredSteps !== undefined && !Array.isArray(configuredSteps)) {
        throw new BadRequestException('Process schema steps must be an array');
      }
      for (const [index, step] of (configuredSteps ?? []).entries()) {
        if (!step || typeof step !== 'object' || Array.isArray(step)) {
          throw new BadRequestException(`Process step ${index + 1} must be an object`);
        }
        const dueInHours = (step as Record<string, unknown>).dueInHours;
        if (dueInHours !== undefined && dueInHours !== null &&
            (typeof dueInHours !== 'number' || !Number.isFinite(dueInHours) || dueInHours <= 0 || dueInHours > 8760)) {
          throw new BadRequestException(`Process step ${index + 1} dueInHours must be greater than 0 and no more than 8760`);
        }
      }
      version.status = 'PUBLISHED';
      version.publishedAt = new Date();
      await manager.save(version);
      definition.status = 'PUBLISHED';
      await manager.save(definition);
      return version;
    });
  }
  async archiveDefinition(id: string) {
    const definition = await this.definitions.findOneBy({ id });
    if (!definition) throw new NotFoundException('Process definition not found');
    definition.status = 'ARCHIVED';
    return this.definitions.save(definition);
  }
}