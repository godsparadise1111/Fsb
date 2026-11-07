import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Organization } from '../organization/entities/organization.entity';
import { User } from '../identity/entities/user.entity';
import { ProcessInstance } from '../workflow/entities/process-instance.entity';
import { FormDefinition } from './entities/form-definition.entity';
import { FormVersion } from './entities/form-version.entity';
import { FormSubmission } from './entities/form-submission.entity';
import { CreateFormDto } from './dto/create-form.dto';
import { CreateFormVersionDto } from './dto/create-form-version.dto';
import { SubmitFormDto } from './dto/submit-form.dto';

@Injectable()
export class FormsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(FormDefinition) private readonly definitions: Repository<FormDefinition>,
    @InjectRepository(FormVersion) private readonly versions: Repository<FormVersion>,
    @InjectRepository(FormSubmission) private readonly submissions: Repository<FormSubmission>,
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ProcessInstance) private readonly instances: Repository<ProcessInstance>,
  ) {}
  async createDefinition(dto: CreateFormDto) {
    if (!await this.organizations.exist({ where: { id: dto.organizationId, isActive: true } })) throw new NotFoundException('Active organization not found');
    if (await this.definitions.findOneBy({ organizationId: dto.organizationId, code: dto.code })) throw new ConflictException('Form code already exists in this organization');
    return this.definitions.save(this.definitions.create({ ...dto, status: 'DRAFT', description: dto.description ?? null }));
  }
  listDefinitions(organizationId?: string) {
    return this.definitions.find({ where: organizationId ? { organizationId } : {}, order: { name: 'ASC' } });
  }
  async createVersion(definitionId: string, dto: CreateFormVersionDto) {
    const definition = await this.definitions.findOneBy({ id: definitionId });
    if (!definition) throw new NotFoundException('Form definition not found');
    if (definition.status === 'ARCHIVED') throw new BadRequestException('Archived form cannot be changed');
    const latest = await this.versions.findOne({ where: { definitionId }, order: { versionNumber: 'DESC' } });
    return this.versions.save(this.versions.create({ definitionId, versionNumber: (latest?.versionNumber ?? 0) + 1, schema: dto.schema, changeNote: dto.changeNote ?? null, status: 'DRAFT' }));
  }
  async listVersions(definitionId: string) {
    if (!await this.definitions.exist({ where: { id: definitionId } })) throw new NotFoundException('Form definition not found');
    return this.versions.find({ where: { definitionId }, order: { versionNumber: 'DESC' } });
  }
  async publishVersion(definitionId: string, versionId: string) {
    return this.dataSource.transaction(async manager => {
      const definition = await manager.findOne(FormDefinition, { where: { id: definitionId }, lock: { mode: 'pessimistic_write' } });
      if (!definition) throw new NotFoundException('Form definition not found');
      if (definition.status === 'ARCHIVED') throw new BadRequestException('Archived form cannot be published');
      const version = await manager.findOne(FormVersion, { where: { id: versionId, definitionId }, lock: { mode: 'pessimistic_write' } });
      if (!version) throw new NotFoundException('Form version not found');
      if (version.status !== 'DRAFT') throw new BadRequestException('Only draft form versions can be published');
      version.status = 'PUBLISHED';
      version.publishedAt = new Date();
      await manager.save(version);
      definition.status = 'PUBLISHED';
      await manager.save(definition);
      return version;
    });
  }
  async submit(versionId: string, submittedByUserId: string, dto: SubmitFormDto) {
    const version = await this.versions.findOne({ where: { id: versionId, status: 'PUBLISHED' }, relations: { definition: true } });
    if (!version) throw new NotFoundException('Published form version not found');
    if (!await this.users.exist({ where: { id: submittedByUserId, isActive: true } })) throw new NotFoundException('Active submitter not found');
    if (dto.processInstanceId) {
      const instance = await this.instances.findOneBy({ id: dto.processInstanceId });
      if (!instance) throw new NotFoundException('Process instance not found');
      if (instance.organizationId !== version.definition.organizationId) throw new BadRequestException('Form and process instance must belong to the same organization');
    }
    return this.submissions.save(this.submissions.create({ formVersionId: versionId, submittedByUserId, processInstanceId: dto.processInstanceId ?? null, data: dto.data }));
  }
  async listSubmissions(versionId: string, organizationId: string) {
    const version = await this.versions.findOne({ where: { id: versionId }, relations: { definition: true } });
    if (!version) throw new NotFoundException('Form version not found');
    if (version.definition.organizationId !== organizationId) throw new BadRequestException('Form does not belong to the selected organization');
    return this.submissions.find({ where: { formVersionId: versionId }, relations: { submittedBy: true }, order: { submittedAt: 'DESC' } });
  }
}