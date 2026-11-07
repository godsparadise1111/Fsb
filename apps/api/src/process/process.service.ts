import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from '../organization/entities/organization.entity';
import { ProcessDefinition } from './entities/process-definition.entity';
import { ProcessVersion } from './entities/process-version.entity';
import { CreateProcessDto } from './dto/create-process.dto';
import { CreateProcessVersionDto } from './dto/create-process-version.dto';

@Injectable()
export class ProcessService {
  constructor(
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
    const definition = await this.definitions.findOneBy({ id: definitionId });
    if (!definition) throw new NotFoundException('Process definition not found');
    if (definition.status === 'ARCHIVED') throw new BadRequestException('Archived process cannot be changed');
    const latest = await this.versions.findOne({ where: { definitionId }, order: { versionNumber: 'DESC' } });
    return this.versions.save(this.versions.create({
      definitionId,
      versionNumber: (latest?.versionNumber ?? 0) + 1,
      status: 'DRAFT',
      schema: dto.schema,
      changeNote: dto.changeNote ?? null,
    }));
  }
  async listVersions(definitionId: string) {
    if (!await this.definitions.exist({ where: { id: definitionId } })) throw new NotFoundException('Process definition not found');
    return this.versions.find({ where: { definitionId }, order: { versionNumber: 'DESC' } });
  }
  async publishVersion(definitionId: string, versionId: string) {
    const version = await this.versions.findOne({ where: { id: versionId, definitionId } });
    if (!version) throw new NotFoundException('Process version not found');
    if (version.status !== 'DRAFT') throw new BadRequestException('Only draft versions can be published');
    version.status = 'PUBLISHED';
    version.publishedAt = new Date();
    await this.versions.save(version);
    const definition = await this.definitions.findOneByOrFail({ id: definitionId });
    definition.status = 'PUBLISHED';
    await this.definitions.save(definition);
    return version;
  }
  async archiveDefinition(id: string) {
    const definition = await this.definitions.findOneBy({ id });
    if (!definition) throw new NotFoundException('Process definition not found');
    definition.status = 'ARCHIVED';
    return this.definitions.save(definition);
  }
}