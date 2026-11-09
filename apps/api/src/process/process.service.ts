import { ConflictException, Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
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
    return this.dataSource.transaction(async manager => {
      const [organization] = await manager.query(
        `SELECT o.id,o."tenantId",t.status AS "tenantStatus"
           FROM organizations o JOIN tenants t ON t.id=o."tenantId"
          WHERE o.id=$1 AND o."isActive"=true FOR UPDATE OF t`,
        [dto.organizationId],
      );
      if (!organization) throw new NotFoundException('Active organization not found');
      if (organization.tenantStatus !== 'ACTIVE') throw new BadRequestException('The organization customer account is not active');
      const [commercial] = await manager.query(
        `SELECT p.limits,s.status,s."currentPeriodEnd",s."trialEndsAt"
           FROM tenant_subscriptions s JOIN commercial_plans p ON p.code=s."planCode"
          WHERE s."tenantId"=$1 FOR UPDATE OF s`, [organization.tenantId],
      );
      const now = Date.now();
      if (!commercial || !['ACTIVE','TRIALING'].includes(commercial.status) ||
          (commercial.currentPeriodEnd && new Date(commercial.currentPeriodEnd).getTime() <= now) ||
          (commercial.status === 'TRIALING' && commercial.trialEndsAt && new Date(commercial.trialEndsAt).getTime() <= now)) {
        throw new BadRequestException('Tenant subscription is not eligible for creating process definitions');
      }
      const maxProcesses = Number(commercial.limits?.maxProcesses ?? 0);
      const [{ count }] = await manager.query(
        `SELECT count(*)::int AS count FROM process_definitions pd
          JOIN organizations o ON o.id=pd."organizationId" WHERE o."tenantId"=$1`,
        [organization.tenantId],
      );
      if (!Number.isInteger(maxProcesses) || maxProcesses < 1 || Number(count) >= maxProcesses) {
        throw new BadRequestException('The active subscription process limit has been reached');
      }
      const definitions = manager.getRepository(ProcessDefinition);
      if (await definitions.findOneBy({ organizationId: dto.organizationId, code: dto.code })) {
        throw new ConflictException('Process code already exists in this organization');
      }
      return definitions.save(definitions.create({ ...dto, status: 'DRAFT' }));
    });
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
      const hasExplicitTransitions = version.schema?.transitions !== undefined;
      if ((configuredSteps ?? []).length > 100) throw new BadRequestException('A process version cannot contain more than 100 steps');
      for (const [index, step] of (configuredSteps ?? []).entries()) {
        if (!step || typeof step !== 'object' || Array.isArray(step)) {
          throw new BadRequestException(`Process step ${index + 1} must be an object`);
        }
        const config = step as Record<string, unknown>;
        if (config.assignmentPolicy !== undefined && !['ANY_ASSIGNEE', 'ALL_ASSIGNEES'].includes(String(config.assignmentPolicy))) {
          throw new BadRequestException(`Process step ${index + 1} assignmentPolicy must be ANY_ASSIGNEE or ALL_ASSIGNEES`);
        }
        if (index > 0 || hasExplicitTransitions) {
          const assigneeIds = config.assigneeUserIds;
          if (!Array.isArray(assigneeIds) || assigneeIds.length < 1 || assigneeIds.length > 50 ||
              assigneeIds.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
            throw new BadRequestException(`Process step ${index + 1} must define between 1 and 50 valid assigneeUserIds`);
          }
          if (new Set(assigneeIds).size !== assigneeIds.length) {
            throw new BadRequestException(`Process step ${index + 1} assigneeUserIds cannot contain duplicates`);
          }
        }
        const dueInHours = config.dueInHours;
        if (dueInHours !== undefined && dueInHours !== null &&
            (typeof dueInHours !== 'number' || !Number.isFinite(dueInHours) || dueInHours <= 0 || dueInHours > 8760)) {
          throw new BadRequestException(`Process step ${index + 1} dueInHours must be greater than 0 and no more than 8760`);
        }
        const escalateAfterHours = config.escalateAfterHours;
        if (escalateAfterHours !== undefined && escalateAfterHours !== null &&
            (typeof escalateAfterHours !== 'number' || !Number.isFinite(escalateAfterHours) || escalateAfterHours < 0 || escalateAfterHours > 8760)) {
          throw new BadRequestException(`Process step ${index + 1} escalateAfterHours must be between 0 and 8760`);
        }
        if (config.escalationUserIds !== undefined &&
            (!Array.isArray(config.escalationUserIds) || config.escalationUserIds.length > 50 ||
             config.escalationUserIds.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)))) {
          throw new BadRequestException(`Process step ${index + 1} escalationUserIds must be an array of at most 50 UUIDs`);
        }
        if (config.escalationUserIds !== undefined && (escalateAfterHours === undefined || escalateAfterHours === null)) {
          throw new BadRequestException(`Process step ${index + 1} must configure escalateAfterHours when escalationUserIds are set`);
        }
        const reassignAfterHours = config.reassignAfterHours;
        if (reassignAfterHours !== undefined && reassignAfterHours !== null &&
            (typeof reassignAfterHours !== 'number' || !Number.isFinite(reassignAfterHours) || reassignAfterHours < 0 || reassignAfterHours > 8760)) {
          throw new BadRequestException(`Process step ${index + 1} reassignAfterHours must be between 0 and 8760`);
        }
        if (config.reassignUserIds !== undefined &&
            (!Array.isArray(config.reassignUserIds) || config.reassignUserIds.length < 1 || config.reassignUserIds.length > 50 ||
             config.reassignUserIds.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)))) {
          throw new BadRequestException(`Process step ${index + 1} reassignUserIds must be an array of 1 to 50 UUIDs`);
        }
        if (Array.isArray(config.reassignUserIds) && new Set(config.reassignUserIds).size !== config.reassignUserIds.length) {
          throw new BadRequestException(`Process step ${index + 1} reassignUserIds cannot contain duplicates`);
        }
        if (config.reassignOnInactiveAssignee !== undefined && typeof config.reassignOnInactiveAssignee !== 'boolean') {
          throw new BadRequestException(`Process step ${index + 1} reassignOnInactiveAssignee must be a boolean`);
        }
        if (config.reassignUserIds !== undefined &&
            (reassignAfterHours === undefined || reassignAfterHours === null) &&
            config.reassignOnInactiveAssignee !== true) {
          throw new BadRequestException(`Process step ${index + 1} reassignUserIds requires an SLA threshold or reassignOnInactiveAssignee=true`);
        }
        if (reassignAfterHours !== undefined && reassignAfterHours !== null &&
            (dueInHours === undefined || dueInHours === null || config.reassignUserIds === undefined)) {
          throw new BadRequestException(`Process step ${index + 1} SLA reassignment requires dueInHours and reassignUserIds`);
        }
        if (config.reassignOnInactiveAssignee === true && config.reassignUserIds === undefined) {
          throw new BadRequestException(`Process step ${index + 1} inactive-assignee reassignment requires reassignUserIds`);
        }
      }
      if (hasExplicitTransitions) {
        const transitions = version.schema?.transitions;
        if (!Array.isArray(transitions) || transitions.length < 1 || transitions.length > 300) {
          throw new BadRequestException('Explicit transitions must contain between 1 and 300 transition rules');
        }
        const keys = new Set<string>();
        const reachable = new Set<number>([0]);
        for (const [index, raw] of transitions.entries()) {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new BadRequestException(`Transition ${index + 1} must be an object`);
          }
          const edge = raw as Record<string, unknown>;
          const from = edge.fromStepIndex;
          const to = edge.toStepIndex;
          const action = edge.action;
          if (!Number.isInteger(from) || Number(from) < 0 || Number(from) >= (configuredSteps ?? []).length) {
            throw new BadRequestException(`Transition ${index + 1} has an invalid fromStepIndex`);
          }
          if (!['APPROVED', 'REJECTED', 'RETURNED'].includes(String(action))) {
            throw new BadRequestException(`Transition ${index + 1} action must be APPROVED, REJECTED or RETURNED`);
          }
          if (to !== null && (!Number.isInteger(to) || Number(to) < 0 || Number(to) >= (configuredSteps ?? []).length || Number(to) === Number(from))) {
            throw new BadRequestException(`Transition ${index + 1} has an invalid toStepIndex`);
          }
          if (action === 'RETURNED' && (to === null || Number(to) >= Number(from))) {
            throw new BadRequestException(`Transition ${index + 1} RETURNED target must be an earlier step`);
          }
          const key = String(from) + ':' + String(action);
          if (keys.has(key)) throw new BadRequestException('Only one transition per step and action is allowed');
          keys.add(key);
          if (to !== null) reachable.add(Number(to));
        }
        let changed = true;
        while (changed) {
          changed = false;
          for (const raw of transitions as Array<Record<string, unknown>>) {
            if (reachable.has(Number(raw.fromStepIndex)) && raw.toStepIndex !== null && !reachable.has(Number(raw.toStepIndex))) {
              reachable.add(Number(raw.toStepIndex));
              changed = true;
            }
          }
        }
        if (reachable.size !== (configuredSteps ?? []).length) {
          throw new BadRequestException('Every process step must be reachable from the first step in the transition graph');
        }
        if (!(transitions as Array<Record<string, unknown>>).some(edge => edge.toStepIndex === null)) {
          throw new BadRequestException('The transition graph must define at least one terminal transition with toStepIndex=null');
        }
        for (let index = 0; index < (configuredSteps ?? []).length; index++) {
          if (!keys.has(index + ':APPROVED')) {
            throw new BadRequestException(`Process step ${index + 1} must define an APPROVED transition`);
          }
        }
      }
      const usesSla = (configuredSteps ?? []).some((step: unknown) => {
        if (!step || typeof step !== 'object' || Array.isArray(step)) return false;
        const config = step as Record<string, unknown>;
        return ['dueInHours', 'escalateAfterHours', 'reassignAfterHours'].some(key =>
          config[key] !== undefined && config[key] !== null,
        );
      });
      if (usesSla) {
        const [entitlement] = await manager.query(
          `SELECT (p.features->>'sla')::boolean AS enabled
             FROM process_definitions pd
             JOIN organizations o ON o.id=pd."organizationId"
             JOIN tenant_subscriptions s ON s."tenantId"=o."tenantId"
             JOIN commercial_plans p ON p.code=s."planCode"
            WHERE pd.id=$1 AND s.status IN ('ACTIVE','TRIALING')
              AND (s."currentPeriodEnd" IS NULL OR s."currentPeriodEnd">now())
              AND (s.status<>'TRIALING' OR s."trialEndsAt" IS NULL OR s."trialEndsAt">now())`,
          [definition.id],
        );
        if (!entitlement?.enabled) {
          throw new ForbiddenException('SLA configuration requires an active subscription with the SLA feature');
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