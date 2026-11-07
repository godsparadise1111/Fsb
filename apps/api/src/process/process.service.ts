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
    if (!await this.organizations.exist({ where: { id: dto.organizationId, isActive: true } })) throw new NotFoundException('Active organization not found');
    if (await this.definitions.findOneBy({ organizationId: dto.organizationId, code: dto.code })) throw new ConflictException('Process code already exists in this organization');
    return this.definitions.save(this.definitions.create({ ...dto, status: 'DRAFT' }));
  }
  listDefinitions(organizationId?: string) {
    return this.definitions.find({ where: organizationId ? { organizationId } : {}, order: { name: 'ASC' } });
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