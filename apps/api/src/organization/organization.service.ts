import { ConflictException, Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../identity/entities/user-role.entity';
import { Organization } from './entities/organization.entity';
import { OrganizationUnit } from './entities/organization-unit.entity';
import { Position } from './entities/position.entity';
import { Tenant } from '../tenant/entities/tenant.entity';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { CreateUnitDto } from './dto/create-unit.dto';
import { CreatePositionDto } from './dto/create-position.dto';
@Injectable()
export class OrganizationService {
  constructor(@InjectRepository(Organization) private readonly organizations: Repository<Organization>, @InjectRepository(OrganizationUnit) private readonly units: Repository<OrganizationUnit>, @InjectRepository(Position) private readonly positions: Repository<Position>, @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>, @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>) {}
  async createOrganization(dto: CreateOrganizationDto) {
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
      return repository.save(repository.create({ ...dto, tenant }));
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
  async createUnit(dto: CreateUnitDto) {
    const organization = await this.organizations.findOne({ where: { id: dto.organizationId, isActive: true } });
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
