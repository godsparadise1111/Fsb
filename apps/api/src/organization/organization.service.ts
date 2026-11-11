import { ConflictException, Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { UserRole } from '../identity/entities/user-role.entity';
import { Organization } from './entities/organization.entity';
import { OrganizationUnit } from './entities/organization-unit.entity';
import { Position } from './entities/position.entity';
import { Tenant } from '../tenant/entities/tenant.entity';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { CreateUnitDto } from './dto/create-unit.dto';
import { CreatePositionDto } from './dto/create-position.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { UpdatePositionDto } from './dto/update-position.dto';
import { TenantAuditService } from '../tenant/tenant-audit.service';
@Injectable()
export class OrganizationService {
  constructor(@InjectRepository(Organization) private readonly organizations: Repository<Organization>, @InjectRepository(OrganizationUnit) private readonly units: Repository<OrganizationUnit>, @InjectRepository(Position) private readonly positions: Repository<Position>, @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>, @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>, private readonly audit: TenantAuditService) {}

  private mutateWithAudit<T>(
    tenantId: string, actorUserId: string, action: string, resourceType: string,
    resourceId: string | null, metadata: Record<string, unknown>,
    persist: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.organizations.manager.transaction(async manager => {
      const result = await persist(manager);
      const id = (result as unknown as { id?: string } | null)?.id ?? resourceId;
      await this.audit.record(manager, { tenantId, actorUserId, action, resourceType, resourceId: id, metadata });
      return result;
    });
  }
  async createOrganization(dto: CreateOrganizationDto, actorUserId?: string) {
    if (!dto.tenantId) throw new BadRequestException('A tenant must be explicitly selected or derived from the authenticated tenant context');
    return this.organizations.manager.transaction(async manager => {
      const tenant = await manager.findOne(Tenant, { where: { id: dto.tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!tenant || tenant.status !== 'ACTIVE') throw new BadRequestException('Organization can only be created for an active tenant');
      const [commercial] = await manager.query(
        `SELECT p.limits,s.status,s."currentPeriodEnd",s."trialEndsAt"
           FROM tenant_subscriptions s JOIN commercial_plans p ON p.code=s."planCode"
          WHERE s."tenantId"=$1 FOR UPDATE OF s`, [tenant.id],
      );
      const now = Date.now();
      if (!commercial || !['ACTIVE','TRIALING'].includes(commercial.status) ||
          (commercial.currentPeriodEnd && new Date(commercial.currentPeriodEnd).getTime() <= now) ||
          (commercial.status === 'TRIALING' && commercial.trialEndsAt && new Date(commercial.trialEndsAt).getTime() <= now)) {
        throw new ForbiddenException('Tenant subscription is not eligible for creating organizations');
      }
      const maxOrganizations = Number(commercial.limits?.maxOrganizations ?? 0);
      const [{ count }] = await manager.query('SELECT count(*)::int AS count FROM organizations WHERE "tenantId"=$1 AND "isActive"=true', [tenant.id]);
      if (!Number.isInteger(maxOrganizations) || maxOrganizations < 1 || Number(count) >= maxOrganizations) {
        throw new BadRequestException('The active subscription organization limit has been reached');
      }
      const repository = manager.getRepository(Organization);
      if (await repository.findOne({ where: { code: dto.code } })) throw new ConflictException('Organization code already exists');
      const created = await repository.save(repository.create({ ...dto, tenant }));
      if (actorUserId) await this.audit.record(manager, { tenantId: tenant.id, actorUserId, action: 'organization.created', resourceType: 'ORGANIZATION', resourceId: created.id, metadata: { code: created.code, name: created.name } });
      return created;
    });
  }
  listOrganizations(tenantId?: string | null) { return this.organizations.find({ where: tenantId ? { tenantId, isActive: true } : { isActive: true }, order: { name: 'ASC' } }); }
  async listAccessibleOrganizations(userId: string, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const [membership] = await this.organizations.manager.query(
      `SELECT tm.\"isTenantAdmin\" FROM tenant_memberships tm
         JOIN tenants t ON t.id=tm.\"tenantId\" AND t.status='ACTIVE'
         JOIN users u ON u.id=tm.\"userId\" AND u.\"isActive\"=true
        WHERE tm.\"tenantId\"=$1 AND tm.\"userId\"=$2 AND tm.\"isActive\"=true LIMIT 1`,
      [tenantId, userId],
    );
    if (!membership) throw new ForbiddenException('An active membership in the selected tenant is required');
    if (membership.isTenantAdmin === true) return this.listOrganizations(tenantId);
    const [platformGrant] = await this.organizations.manager.query(
      `SELECT 1 FROM user_roles ur
         JOIN roles r ON r.id=ur.\"roleId\" AND r.scope='PLATFORM' AND r.\"isActive\"=true
         JOIN role_permissions rp ON rp.\"roleId\"=r.id
         JOIN permissions p ON p.id=rp.\"permissionId\" AND p.code IN ('organization.read','*')
        WHERE ur.\"userId\"=$1 AND ur.\"isActive\"=true LIMIT 1`,
      [userId],
    );
    if (platformGrant) return this.listOrganizations(tenantId);
    const grants = await this.userRoles.find({
      where: { userId, isActive: true },
      relations: { role: { permissions: true }, organization: true },
    });
    const organizationIds = [...new Set(grants
      .filter(grant => grant.role?.isActive && grant.role.scope === 'ORGANIZATION' &&
        grant.organization?.isActive && grant.organization.tenantId === tenantId &&
        (grant.role.permissions ?? []).some(permission => permission.code === 'organization.read'))
      .map(grant => grant.organizationId)
      .filter((id): id is string => Boolean(id)))];
    if (!organizationIds.length) return [];
    return this.organizations.find({
      where: organizationIds.map(id => ({ id, tenantId, isActive: true })),
      order: { name: 'ASC' },
    });
  }
  async createUnit(dto: CreateUnitDto, tenantId?: string | null, actorUserId?: string) {
    if (!tenantId || !actorUserId) throw new ForbiddenException('An active tenant context and actor are required');
    const organization = await this.organizations.createQueryBuilder('organization').innerJoin('organization.tenant', 'tenant')
      .where('organization.id = :organizationId AND organization.tenantId = :tenantId AND organization.isActive = true AND tenant.status = :active', { organizationId: dto.organizationId, tenantId, active: 'ACTIVE' }).getOne();
    if (!organization) throw new NotFoundException('Organization not found');
    if (dto.parentId) {
      const parent = await this.units.findOne({ where: { id: dto.parentId, organizationId: dto.organizationId, isActive: true } });
      if (!parent) throw new BadRequestException('Parent unit must belong to the same organization');
    }
    const duplicate = await this.units.createQueryBuilder('unit')
      .where('unit.organizationId = :organizationId AND unit.code = :code', { organizationId: dto.organizationId, code: dto.code })
      .andWhere('unit.parentId IS NOT DISTINCT FROM :parentId', { parentId: dto.parentId ?? null })
      .getOne();
    if (duplicate) throw new ConflictException('Unit code already exists under this parent');
    return this.mutateWithAudit(tenantId, actorUserId, 'organization.unit.created', 'ORGANIZATION_UNIT', null, { organizationId: dto.organizationId, code: dto.code, parentId: dto.parentId ?? null }, manager => manager.save(OrganizationUnit, manager.create(OrganizationUnit, { ...dto, parentId: dto.parentId ?? null })));
  }
  async listUnits(organizationId: string, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const organization = await this.organizations.createQueryBuilder('organization').innerJoin('organization.tenant', 'tenant')
      .where('organization.id = :organizationId AND organization.tenantId = :tenantId AND organization.isActive = true AND tenant.status = :active', { organizationId, tenantId, active: 'ACTIVE' }).getOne();
    if (!organization) throw new NotFoundException('Organization not found');
    return this.units.find({ where: { organizationId, isActive: true }, relations: { parent: true }, order: { name: 'ASC' } });
  }
  async createPosition(dto: CreatePositionDto, tenantId?: string | null, actorUserId?: string) {
    if (!tenantId || !actorUserId) throw new ForbiddenException('An active tenant context and actor are required');
    const unit = await this.units.createQueryBuilder('unit')
      .innerJoin('unit.organization', 'organization')
      .innerJoin('organization.tenant', 'tenant')
      .where('unit.id = :unitId AND unit.isActive = true AND organization.isActive = true AND organization.tenantId = :tenantId AND tenant.status = :active', { unitId: dto.organizationUnitId, tenantId, active: 'ACTIVE' })
      .getOne();
    if (!unit) throw new NotFoundException('Organization unit not found');
    if (await this.positions.findOne({ where: { organizationUnitId: dto.organizationUnitId, code: dto.code } })) throw new ConflictException('Position code already exists in this unit');
    return this.mutateWithAudit(tenantId, actorUserId, 'organization.position.created', 'POSITION', null, { organizationUnitId: dto.organizationUnitId, code: dto.code }, manager => manager.save(Position, manager.create(Position, dto)));
  }
  async updateUnit(unitId: string, dto: UpdateUnitDto, tenantId?: string | null, actorUserId?: string) {
    if (!tenantId || !actorUserId) throw new ForbiddenException('An active tenant context and actor are required');
    const unit = await this.units.createQueryBuilder('unit')
      .innerJoin('unit.organization', 'organization').innerJoin('organization.tenant', 'tenant')
      .where('unit.id=:unitId AND unit.isActive=true AND organization.isActive=true AND organization.tenantId=:tenantId AND tenant.status=:active', { unitId, tenantId, active: 'ACTIVE' })
      .getOne();
    if (!unit) throw new NotFoundException('Organization unit not found');
    if (dto.parentId) {
      const [cycle] = await this.units.manager.query(
        `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM organization_units WHERE id=$1
           UNION ALL
           SELECT child.id FROM organization_units child JOIN descendants d ON child."parentId"=d.id
         ) SELECT id FROM descendants WHERE id=$2 LIMIT 1`,
        [unitId, dto.parentId],
      );
      if (cycle) throw new BadRequestException('A unit cannot be moved below itself or one of its descendants');
      const parent = await this.units.findOne({ where: { id: dto.parentId, organizationId: unit.organizationId, isActive: true } });
      if (!parent) throw new BadRequestException('Parent unit must be active and belong to the same organization');
    }
    const nextCode = dto.code ?? unit.code;
    const nextParent = dto.parentId ?? unit.parentId;
    const duplicate = await this.units.createQueryBuilder('other')
      .where('other.organizationId=:organizationId AND other.id<>:unitId AND other.code=:code', { organizationId: unit.organizationId, unitId, code: nextCode })
      .andWhere('other.parentId IS NOT DISTINCT FROM :parentId', { parentId: nextParent })
      .getOne();
    if (duplicate) throw new ConflictException('Unit code already exists under this parent');
    Object.assign(unit, { name: dto.name ?? unit.name, code: nextCode, parentId: nextParent });
    return this.mutateWithAudit(tenantId, actorUserId, 'organization.unit.updated', 'ORGANIZATION_UNIT', unit.id, { name: unit.name, code: unit.code, parentId: unit.parentId }, manager => manager.save(OrganizationUnit, unit));
  }

  async deactivateUnit(unitId: string, tenantId?: string | null, actorUserId?: string) {
    if (!tenantId || !actorUserId) throw new ForbiddenException('An active tenant context and actor are required');
    const unit = await this.units.createQueryBuilder('unit')
      .innerJoin('unit.organization', 'organization').innerJoin('organization.tenant', 'tenant')
      .where('unit.id=:unitId AND unit.isActive=true AND organization.tenantId=:tenantId AND tenant.status=:active', { unitId, tenantId, active: 'ACTIVE' })
      .getOne();
    if (!unit) throw new NotFoundException('Organization unit not found');
    const [dependencies] = await this.units.manager.query(
      `SELECT
         (SELECT count(*)::int FROM organization_units WHERE "parentId"=$1 AND "isActive"=true) AS children,
         (SELECT count(*)::int FROM positions WHERE "organizationUnitId"=$1 AND "isActive"=true) AS positions`,
      [unitId],
    );
    if (Number(dependencies.children) || Number(dependencies.positions)) {
      throw new ConflictException('Move or deactivate active child units and positions before deactivating this unit');
    }
    unit.isActive = false;
    return this.mutateWithAudit(tenantId, actorUserId, 'organization.unit.deactivated', 'ORGANIZATION_UNIT', unit.id, {}, manager => manager.save(OrganizationUnit, unit));
  }

  async updatePosition(positionId: string, dto: UpdatePositionDto, tenantId?: string | null, actorUserId?: string) {
    if (!tenantId || !actorUserId) throw new ForbiddenException('An active tenant context and actor are required');
    const position = await this.positions.createQueryBuilder('position')
      .innerJoin('position.unit', 'unit').innerJoin('unit.organization', 'organization').innerJoin('organization.tenant', 'tenant')
      .where('position.id=:positionId AND position.isActive=true AND unit.isActive=true AND organization.isActive=true AND organization.tenantId=:tenantId AND tenant.status=:active', { positionId, tenantId, active: 'ACTIVE' })
      .getOne();
    if (!position) throw new NotFoundException('Position not found');
    const code = dto.code ?? position.code;
    if (await this.positions.createQueryBuilder('other').where('other.organizationUnitId=:unitId AND other.id<>:positionId AND other.code=:code', { unitId: position.organizationUnitId, positionId, code }).getExists()) {
      throw new ConflictException('Position code already exists in this unit');
    }
    Object.assign(position, { title: dto.title ?? position.title, code });
    return this.mutateWithAudit(tenantId, actorUserId, 'organization.position.updated', 'POSITION', position.id, { title: position.title, code: position.code }, manager => manager.save(Position, position));
  }

  async deactivatePosition(positionId: string, tenantId?: string | null, actorUserId?: string) {
    if (!tenantId || !actorUserId) throw new ForbiddenException('An active tenant context and actor are required');
    const position = await this.positions.createQueryBuilder('position')
      .innerJoin('position.unit', 'unit').innerJoin('unit.organization', 'organization').innerJoin('organization.tenant', 'tenant')
      .where('position.id=:positionId AND position.isActive=true AND unit.isActive=true AND organization.isActive=true AND organization.tenantId=:tenantId AND tenant.status=:active', { positionId, tenantId, active: 'ACTIVE' })
      .getOne();
    if (!position) throw new NotFoundException('Position not found');
    const [assignment] = await this.positions.manager.query(
      `SELECT id FROM user_positions WHERE "positionId"=$1 AND "isActive"=true
        AND ("validUntil" IS NULL OR "validUntil">=now()) LIMIT 1`,
      [positionId],
    );
    if (assignment) throw new ConflictException('End active user assignments before deactivating this position');
    position.isActive = false;
    return this.mutateWithAudit(tenantId, actorUserId, 'organization.position.deactivated', 'POSITION', position.id, {}, manager => manager.save(Position, position));
  }

  async listPositions(unitId: string, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const unit = await this.units.createQueryBuilder('unit').innerJoin('unit.organization', 'organization').innerJoin('organization.tenant', 'tenant')
      .where('unit.id = :unitId AND unit.isActive = true AND organization.isActive = true AND organization.tenantId = :tenantId AND tenant.status = :active', { unitId, tenantId, active: 'ACTIVE' }).getOne();
    if (!unit) throw new NotFoundException('Organization unit not found');
    return this.positions.find({ where: { organizationUnitId: unitId, isActive: true }, order: { title: 'ASC' } });
  }
}
