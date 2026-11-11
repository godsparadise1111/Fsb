import { ConflictException, Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Organization } from '../organization/entities/organization.entity';
import { ProcessDefinition } from './entities/process-definition.entity';
import { ProcessVersion } from './entities/process-version.entity';
import { CreateProcessDto } from './dto/create-process.dto';
import { CreateProcessVersionDto } from './dto/create-process-version.dto';
import { TenantAuditService } from '../tenant/tenant-audit.service';

@Injectable()
export class ProcessService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ProcessDefinition) private readonly definitions: Repository<ProcessDefinition>,
    @InjectRepository(ProcessVersion) private readonly versions: Repository<ProcessVersion>,
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    private readonly audit: TenantAuditService,
  ) {}

  private async lockActiveDefinitionScope(manager: EntityManager, definitionId: string, tenantId: string) {
    const rows = await manager.query(
      `SELECT pd.id FROM process_definitions pd
         JOIN organizations o ON o.id=pd."organizationId" AND o."tenantId"=$2 AND o."isActive"=true
         JOIN tenants t ON t.id=o."tenantId" AND t.status='ACTIVE'
        WHERE pd.id=$1
        FOR SHARE OF pd,o,t`,
      [definitionId, tenantId],
    );
    if (!rows.length) throw new NotFoundException('Process definition not found in the active tenant');
  }

  async createDefinition(dto: CreateProcessDto, tenantId: string | null | undefined, actorUserId: string) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    return this.dataSource.transaction(async manager => {
      const [organization] = await manager.query(
        `SELECT o.id,o."tenantId",t.status AS "tenantStatus"
           FROM organizations o JOIN tenants t ON t.id=o."tenantId"
          WHERE o.id=$1 AND o."tenantId"=$2 AND o."isActive"=true FOR SHARE OF o,t`,
        [dto.organizationId, tenantId],
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
      const created = await definitions.save(definitions.create({ ...dto, status: 'DRAFT' }));
      await this.audit.record(manager, { tenantId, actorUserId, action: 'workflow.process_definition.created', resourceType: 'PROCESS_DEFINITION', resourceId: created.id, metadata: { organizationId: dto.organizationId, code: dto.code } });
      return created;
    });
  }
  listDefinitions(organizationId: string | undefined, tenantId: string | null | undefined) {
    if (!tenantId) return Promise.resolve([]);
    const query = this.definitions.createQueryBuilder('definition')
      .innerJoinAndSelect('definition.organization', 'organization')
      .innerJoin('organization.tenant', 'tenant', 'tenant.status = :activeTenant', { activeTenant: 'ACTIVE' })
      .orderBy('definition.name', 'ASC');
    query.andWhere('organization.tenantId = :tenantId AND organization.isActive = true', { tenantId });
    if (organizationId) query.andWhere('definition.organizationId = :organizationId', { organizationId });
    return query.getMany();
  }
  async createVersion(definitionId: string, dto: CreateProcessVersionDto, tenantId: string | null | undefined, actorUserId: string) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    return this.dataSource.transaction(async manager => {
      await this.lockActiveDefinitionScope(manager, definitionId, tenantId);
      const definition = await manager.findOne(ProcessDefinition, { where: { id: definitionId }, lock: { mode: 'pessimistic_write' } });
      if (!definition || definition.tenantId !== tenantId) throw new NotFoundException('Process definition not found');
      if (definition.status === 'ARCHIVED') throw new BadRequestException('Archived process cannot be changed');
      const latest = await manager.findOne(ProcessVersion, { where: { definitionId }, order: { versionNumber: 'DESC' } });
      const created = await manager.save(ProcessVersion, manager.create(ProcessVersion, {
        definitionId, versionNumber: (latest?.versionNumber ?? 0) + 1, status: 'DRAFT',
        schema: dto.schema, changeNote: dto.changeNote ?? null,
      }));
      await this.audit.record(manager, { tenantId, actorUserId, action: 'workflow.process_version.created', resourceType: 'PROCESS_VERSION', resourceId: created.id, metadata: { definitionId, versionNumber: created.versionNumber, changeNote: created.changeNote } });
      return created;
    });
  }
  async listVersions(definitionId: string, tenantId: string | null | undefined) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const rows = await this.versions.createQueryBuilder('version')
      .innerJoin('version.definition', 'definition')
      .innerJoin('definition.organization', 'organization')
      .innerJoin('organization.tenant', 'tenant', 'tenant.status = :activeTenant', { activeTenant: 'ACTIVE' })
      .where('version.definitionId = :definitionId AND organization.tenantId = :tenantId AND organization.isActive = true', { definitionId, tenantId })
      .orderBy('version.versionNumber', 'DESC').getMany();
    if (!rows.length && !await this.definitions.createQueryBuilder('definition')
      .innerJoin('definition.organization', 'organization')
      .innerJoin('organization.tenant', 'tenant', 'tenant.status = :activeTenant', { activeTenant: 'ACTIVE' })
      .where('definition.id = :definitionId AND organization.tenantId = :tenantId AND organization.isActive = true', { definitionId, tenantId }).getExists()) {
      throw new NotFoundException('Process definition not found');
    }
    return rows;
  }
  async publishVersion(definitionId: string, versionId: string, tenantId: string | null | undefined, actorUserId: string) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    return this.dataSource.transaction(async manager => {
      await this.lockActiveDefinitionScope(manager, definitionId, tenantId);
      const definition = await manager.findOne(ProcessDefinition, { where: { id: definitionId }, lock: { mode: 'pessimistic_write' } });
      if (!definition || definition.tenantId !== tenantId) throw new NotFoundException('Process definition not found');
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
        if (config.title !== undefined && (typeof config.title !== 'string' || !config.title.trim() || config.title.length > 200)) {
          throw new BadRequestException(`Process step ${index + 1} title must be a non-empty string up to 200 characters`);
        }
        if (config.instructions !== undefined && config.instructions !== null &&
            (typeof config.instructions !== 'string' || config.instructions.length > 4000)) {
          throw new BadRequestException(`Process step ${index + 1} instructions must be text up to 4000 characters`);
        }
        if (config.assignmentPolicy !== undefined && !['ANY_ASSIGNEE', 'ALL_ASSIGNEES'].includes(String(config.assignmentPolicy))) {
          throw new BadRequestException(`Process step ${index + 1} assignmentPolicy must be ANY_ASSIGNEE or ALL_ASSIGNEES`);
        }
        const assignmentFields = ['assigneeUserIds', 'assigneePositionIds', 'assigneeUnitIds'] as const;
        let hasAssigneeSource = false;
        let configuredAssigneeCount = 0;
        for (const field of assignmentFields) {
          const values = config[field];
          if (values === undefined) continue;
          if (!Array.isArray(values) || values.length < 1 || values.length > 50 ||
              values.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
            throw new BadRequestException(`Process step ${index + 1} ${field} must contain between 1 and 50 valid UUIDs`);
          }
          if (new Set(values).size !== values.length) {
            throw new BadRequestException(`Process step ${index + 1} ${field} cannot contain duplicates`);
          }
          hasAssigneeSource = true;
          configuredAssigneeCount += values.length;
        }
        if (configuredAssigneeCount > 50) {
          throw new BadRequestException(`Process step ${index + 1} cannot configure more than 50 assignee targets in total`);
        }
        if ((index > 0 || hasExplicitTransitions) && !hasAssigneeSource) {
          throw new BadRequestException(`Process step ${index + 1} must define assigneeUserIds, assigneePositionIds or assigneeUnitIds`);
        }
        if (hasAssigneeSource) {
          const userIds = Array.isArray(config.assigneeUserIds) ? config.assigneeUserIds as string[] : [];
          const positionIds = Array.isArray(config.assigneePositionIds) ? config.assigneePositionIds as string[] : [];
          const unitIds = Array.isArray(config.assigneeUnitIds) ? config.assigneeUnitIds as string[] : [];
          if (userIds.length) {
            const [eligibleUsers] = await manager.query(
              `SELECT count(DISTINCT up."userId")::int AS count
                 FROM user_positions up
                 JOIN positions p ON p.id=up."positionId" AND p."isActive"=true
                 JOIN organization_units ou ON ou.id=p."organizationUnitId" AND ou."organizationId"=$1 AND ou."isActive"=true
                 JOIN tenant_memberships tm ON tm."tenantId"=$2 AND tm."userId"=up."userId" AND tm."isActive"=true
                 JOIN users u ON u.id=up."userId" AND u."isActive"=true
                WHERE up."userId"=ANY($3::uuid[]) AND up."isActive"=true
                  AND up."validFrom"<=now() AND (up."validUntil" IS NULL OR up."validUntil">=now())`,
              [definition.organizationId, definition.tenantId, userIds],
            );
            if (Number(eligibleUsers?.count ?? 0) !== userIds.length) {
              throw new BadRequestException(`Process step ${index + 1} directly assigned users must have active membership and position in the process organization`);
            }
          }
          if (positionIds.length) {
            const [validPositions] = await manager.query(
              `SELECT count(*)::int AS count FROM positions p
                JOIN organization_units ou ON ou.id=p."organizationUnitId" AND ou."organizationId"=$1 AND ou."isActive"=true
               WHERE p.id=ANY($2::uuid[]) AND p."isActive"=true`,
              [definition.organizationId, positionIds],
            );
            if (Number(validPositions?.count ?? 0) !== positionIds.length) {
              throw new BadRequestException(`Process step ${index + 1} positions must be active and belong to the process organization`);
            }
          }
          if (unitIds.length) {
            const [validUnits] = await manager.query(
              'SELECT count(*)::int AS count FROM organization_units WHERE id=ANY($2::uuid[]) AND "organizationId"=$1 AND "isActive"=true',
              [definition.organizationId, unitIds],
            );
            if (Number(validUnits?.count ?? 0) !== unitIds.length) {
              throw new BadRequestException(`Process step ${index + 1} units must be active and belong to the process organization`);
            }
          }
          const [resolvedTargets] = await manager.query(
            `SELECT count(DISTINCT up."userId")::int AS count
               FROM user_positions up
               JOIN positions p ON p.id=up."positionId" AND p."isActive"=true
               JOIN organization_units ou ON ou.id=p."organizationUnitId" AND ou."organizationId"=$1 AND ou."isActive"=true
               JOIN tenant_memberships tm ON tm."tenantId"=$2 AND tm."userId"=up."userId" AND tm."isActive"=true
               JOIN users u ON u.id=up."userId" AND u."isActive"=true
              WHERE up."isActive"=true AND up."validFrom"<=now()
                AND (up."validUntil" IS NULL OR up."validUntil">=now())
                AND (up."userId"=ANY($3::uuid[]) OR p.id=ANY($4::uuid[]) OR ou.id=ANY($5::uuid[]))`,
            [definition.organizationId, definition.tenantId, userIds, positionIds, unitIds],
          );
          if (Number(resolvedTargets?.count ?? 0) > 50) {
            throw new BadRequestException(`Process step ${index + 1} targets currently resolve to more than 50 active users`);
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
          if (edge.when !== undefined) {
            const validCondition = (condition: unknown): boolean => {
              if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return false;
              const item = condition as Record<string, unknown>;
              return typeof item.field === 'string' &&
                /^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*){0,7}$/.test(item.field) &&
                ['exists','eq','neq','gt','gte','lt','lte','in','contains'].includes(String(item.operator));
            };
            const rule = edge.when as Record<string, unknown>;
            if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
              throw new BadRequestException(`Transition ${index + 1} when must be a condition object`);
            }
            if (rule.all !== undefined || rule.any !== undefined) {
              const all = rule.all === undefined ? [] : rule.all;
              const any = rule.any === undefined ? [] : rule.any;
              if (!Array.isArray(all) || !Array.isArray(any) || all.length + any.length < 1 ||
                  all.length + any.length > 20 || [...all, ...any].some(item => !validCondition(item))) {
                throw new BadRequestException(`Transition ${index + 1} all/any conditions are invalid`);
              }
            } else if (!validCondition(rule)) {
              throw new BadRequestException(`Transition ${index + 1} condition is invalid`);
            }
          }
          const existing = (transitions as Array<Record<string, unknown>>).filter(item =>
            item !== edge && item.fromStepIndex === from && item.action === action,
          );
          if (existing.length && (edge.when === undefined || existing.some(item => item.when === undefined))) {
            throw new BadRequestException('Multiple transitions for one step/action must all define conditions');
          }
          keys.add(key);
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
        if (!(transitions as Array<Record<string, unknown>>).some(edge => edge.action === 'APPROVED' && edge.toStepIndex === null)) {
          throw new BadRequestException('The transition graph must define at least one terminal APPROVED transition with toStepIndex=null');
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
      await this.audit.record(manager, { tenantId, actorUserId, action: 'workflow.process_version.published', resourceType: 'PROCESS_VERSION', resourceId: version.id, metadata: { definitionId, versionNumber: version.versionNumber } });
      return version;
    });
  }
  async archiveDefinition(id: string, tenantId: string | null | undefined, actorUserId: string) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    return this.dataSource.transaction(async manager => {
      await this.lockActiveDefinitionScope(manager, id, tenantId);
      const definition = await manager.findOne(ProcessDefinition, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!definition || definition.tenantId !== tenantId) throw new NotFoundException('Process definition not found');
      if (definition.status === 'ARCHIVED') return definition;
      definition.status = 'ARCHIVED';
      const archived = await manager.save(definition);
      await this.audit.record(manager, { tenantId, actorUserId, action: 'workflow.process_definition.archived', resourceType: 'PROCESS_DEFINITION', resourceId: definition.id, metadata: { organizationId: definition.organizationId, code: definition.code } });
      return archived;
    });
  }
}