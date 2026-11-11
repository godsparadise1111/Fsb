import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
  async createDefinition(dto: CreateFormDto, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const organization = await this.organizations.findOne({ where: { id: dto.organizationId, tenantId, isActive: true }, relations: { tenant: true } });
    if (!organization) throw new NotFoundException('Active organization not found');
    if (!organization.tenant || organization.tenant.status !== 'ACTIVE') throw new BadRequestException('The organization customer account is not active');
    if (await this.definitions.findOneBy({ organizationId: dto.organizationId, code: dto.code })) throw new ConflictException('Form code already exists in this organization');
    return this.definitions.save(this.definitions.create({ ...dto, status: 'DRAFT', description: dto.description ?? null }));
  }
  listDefinitions(organizationId?: string, tenantId?: string | null) {
    if (!tenantId) return Promise.resolve([]);
    const query = this.definitions.createQueryBuilder('definition')
      .innerJoinAndSelect('definition.organization', 'organization')
      .orderBy('definition.name', 'ASC');
    query.andWhere('organization.tenantId = :tenantId AND organization.isActive = true', { tenantId });
    if (organizationId) query.andWhere('definition.organizationId = :organizationId', { organizationId });
    return query.getMany();
  }
  async createVersion(definitionId: string, dto: CreateFormVersionDto, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    return this.dataSource.transaction(async manager => {
      const definition = await manager.createQueryBuilder(FormDefinition, 'definition')
        .innerJoin('definition.organization', 'organization')
        .where('definition.id = :definitionId AND organization.tenantId = :tenantId AND organization.isActive = true', { definitionId, tenantId })
        .setLock('pessimistic_write').getOne();
      if (!definition) throw new NotFoundException('Form definition not found');
      if (definition.status === 'ARCHIVED') throw new BadRequestException('Archived form cannot be changed');
      const latest = await manager.findOne(FormVersion, { where: { definitionId }, order: { versionNumber: 'DESC' } });
      return manager.save(FormVersion, manager.create(FormVersion, {
        definitionId, versionNumber: (latest?.versionNumber ?? 0) + 1, schema: dto.schema,
        changeNote: dto.changeNote ?? null, status: 'DRAFT',
      }));
    });
  }
  async listVersions(definitionId: string, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const rows = await this.versions.createQueryBuilder('version')
      .innerJoin('version.definition', 'definition')
      .innerJoin('definition.organization', 'organization')
      .where('version.definitionId = :definitionId AND organization.tenantId = :tenantId AND organization.isActive = true', { definitionId, tenantId })
      .orderBy('version.versionNumber', 'DESC').getMany();
    if (!rows.length && !await this.definitions.createQueryBuilder('definition').innerJoin('definition.organization', 'organization')
      .where('definition.id = :definitionId AND organization.tenantId = :tenantId AND organization.isActive = true', { definitionId, tenantId }).getExists()) {
      throw new NotFoundException('Form definition not found');
    }
    return rows;
  }
  async publishVersion(definitionId: string, versionId: string, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    return this.dataSource.transaction(async manager => {
      const definition = await manager.createQueryBuilder(FormDefinition, 'definition')
        .innerJoin('definition.organization', 'organization')
        .where('definition.id = :definitionId AND organization.tenantId = :tenantId AND organization.isActive = true', { definitionId, tenantId })
        .setLock('pessimistic_write').getOne();
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
  async submit(versionId: string, submittedByUserId: string, dto: SubmitFormDto, tenantId?: string | null) {
    if (!tenantId) throw new BadRequestException('An active tenant context is required to submit a form');
    const version = await this.versions.findOne({ where: { id: versionId, status: 'PUBLISHED' }, relations: { definition: { organization: { tenant: true } } } });
    if (!version) throw new NotFoundException('Published form version not found');
    if (version.definition.organization?.tenantId !== tenantId || version.definition.organization.tenant?.status !== 'ACTIVE') {
      throw new BadRequestException('Form is outside the active customer account');
    }
    if (!await this.users.exist({ where: { id: submittedByUserId, isActive: true } })) throw new NotFoundException('Active submitter not found');
    if (dto.processInstanceId) {
      const instance = await this.instances.findOne({ where: { id: dto.processInstanceId }, relations: { organization: { tenant: true } } });
      if (!instance) throw new NotFoundException('Process instance not found');
      if (instance.organizationId !== version.definition.organizationId || instance.organization?.tenantId !== tenantId || instance.organization.tenant?.status !== 'ACTIVE') {
        throw new BadRequestException('Form and process instance must belong to the same active tenant and organization');
      }
    }
    return this.submissions.save(this.submissions.create({ formVersionId: versionId, submittedByUserId, processInstanceId: dto.processInstanceId ?? null, data: dto.data }));
  }
  async listSubmissions(versionId: string, tenantId?: string | null, requestedLimit = 50, requestedOffset = 0) {
    const version = await this.versions.findOne({ where: { id: versionId }, relations: { definition: { organization: { tenant: true } } } });
    if (!version) throw new NotFoundException('Form version not found');
    if (!tenantId || version.definition.organization?.tenantId !== tenantId || version.definition.organization.tenant?.status !== 'ACTIVE') {
      throw new BadRequestException('Form submissions are outside the active customer account');
    }
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(Math.trunc(requestedLimit), 100) : 50;
    const offset = Number.isFinite(requestedOffset) && requestedOffset >= 0 ? Math.min(Math.trunc(requestedOffset), 100000) : 0;
    const [items, total] = await this.submissions.createQueryBuilder('submission')
      .leftJoin('submission.submittedBy', 'submitter')
      .select([
        'submission.id', 'submission.formVersionId', 'submission.submittedByUserId',
        'submission.processInstanceId', 'submission.data', 'submission.submittedAt',
      ])
      .addSelect(['submitter.id', 'submitter.firstName', 'submitter.lastName', 'submitter.email'])
      .where('submission.formVersionId = :versionId', { versionId })
      .andWhere('submission.tenantId = :tenantId', { tenantId })
      .orderBy('submission.submittedAt', 'DESC')
      .addOrderBy('submission.id', 'DESC')
      .take(limit)
      .skip(offset)
      .getManyAndCount();
    return { items, pagination: { total, limit, offset, hasMore: offset + items.length < total } };
  }

  async exportSubmissions(versionId: string, tenantId?: string | null, requestedLimit = 1000, requestedOffset = 0) {
    const version = await this.versions.findOne({ where: { id: versionId }, relations: { definition: { organization: { tenant: true } } } });
    if (!version) throw new NotFoundException('Form version not found');
    if (!tenantId || version.definition.organization?.tenantId !== tenantId || version.definition.organization.tenant?.status !== 'ACTIVE') {
      throw new BadRequestException('Form submissions are outside the active customer account');
    }
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(Math.trunc(requestedLimit), 5000) : 1000;
    const offset = Number.isFinite(requestedOffset) && requestedOffset >= 0 ? Math.min(Math.trunc(requestedOffset), 100000) : 0;
    const rows = await this.dataSource.query(
      `SELECT fs.id AS "submissionId", fs."submittedAt", fs."processInstanceId", fs.data,
              u."firstName", u."lastName", u.email
         FROM form_submissions fs
         INNER JOIN form_versions fv ON fv.id = fs."formVersionId"
         INNER JOIN form_definitions fd ON fd.id = fv."definitionId"
         INNER JOIN organizations o ON o.id = fd."organizationId"
         INNER JOIN tenants t ON t.id = o."tenantId"
         LEFT JOIN users u ON u.id = fs."submittedByUserId"
        WHERE fv.id = $1 AND fs."tenantId" = $2 AND t.status = 'ACTIVE'
        ORDER BY fs."submittedAt" DESC, fs.id DESC
        LIMIT $3 OFFSET $4`,
      [versionId, tenantId, limit, offset],
    );
    const cell = (value: unknown) => {
      let text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
      const first = text.trimStart()[0];
      if ((first !== undefined && '=+-@'.includes(first)) || text.startsWith('\t') || text.startsWith('\r')) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    const headers = ['شناسه ثبت', 'تاریخ ثبت', 'شناسه نمونه فرایند', 'نام ثبت‌کننده', 'ایمیل ثبت‌کننده', 'داده‌های فرم'];
    const lines = [
      headers.map(cell).join(','),
      ...rows.map((row: any) => [
        row.submissionId, row.submittedAt instanceof Date ? row.submittedAt.toISOString() : row.submittedAt,
        row.processInstanceId, [row.firstName, row.lastName].filter(Boolean).join(' '), row.email, row.data,
      ].map(cell).join(',')),
    ];
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

}