import { ConflictException, Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { IsNull, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UserPosition } from './entities/user-position.entity';
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { UserRole } from './entities/user-role.entity';
import { Position } from '../organization/entities/position.entity';
import { Organization } from '../organization/entities/organization.entity';
import { TenantMembership } from '../tenant/entities/tenant-membership.entity';
import { Tenant } from '../tenant/entities/tenant.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { AssignPositionDto } from './dto/assign-position.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { CreatePermissionDto } from './dto/create-permission.dto';

@Injectable()
export class IdentityService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserPosition) private readonly memberships: Repository<UserPosition>,
    @InjectRepository(Position) private readonly positions: Repository<Position>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(Permission) private readonly permissions: Repository<Permission>,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>,
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
  ) {}

  async createUser(dto: CreateUserDto) {
    if (await this.users.findOne({ where: [{ email: dto.email.toLowerCase() }, { username: dto.username }] })) throw new ConflictException('Email or username already exists');
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const { password, ...profile } = dto;
    return this.users.save(this.users.create({ ...profile, passwordHash, email: dto.email.toLowerCase() }));
  }
  listUsers(tenantId?: string | null) {
    if (!tenantId) return this.users.find({ where: { isActive: true }, order: { lastName: 'ASC', firstName: 'ASC' } });
    return this.users.createQueryBuilder('user')
      .innerJoin('tenant_memberships', 'membership', 'membership.\"userId\" = user.id AND membership.\"tenantId\" = :tenantId AND membership.\"isActive\" = true', { tenantId })
      .innerJoin('tenants', 'tenant', 'tenant.id = :tenantId AND tenant.status = :tenantStatus', { tenantId, tenantStatus: 'ACTIVE' })
      .where('user.isActive = true').orderBy('user.lastName', 'ASC').addOrderBy('user.firstName', 'ASC').getMany();
  }
  async setUserActive(id: string, isActive: boolean) {
    return this.users.manager.transaction(async manager => {
      const user = await manager.findOne(User, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!user) throw new NotFoundException('User not found');
      if (!isActive && user.isActive) {
        const adminMemberships = await manager.find(TenantMembership, {
          where: { userId: id, isActive: true, isTenantAdmin: true },
          order: { tenantId: 'ASC' },
        });
        for (const membership of adminMemberships) {
          await manager.findOne(Tenant, { where: { id: membership.tenantId }, lock: { mode: 'pessimistic_write' } });
          const otherAdmins = await manager.getRepository(TenantMembership).createQueryBuilder('membership')
            .innerJoin('membership.user', 'adminUser', 'adminUser.isActive = true')
            .where('membership.tenantId = :tenantId AND membership.isActive = true AND membership.isTenantAdmin = true', { tenantId: membership.tenantId })
            .andWhere('membership.userId <> :userId', { userId: id })
            .getCount();
          if (otherAdmins === 0) throw new BadRequestException('Transfer tenant administration before deactivating the last active tenant administrator');
        }
      }
      user.isActive = isActive;
      return manager.save(user);
    });
  }
  async assignPosition(dto: AssignPositionDto) {
    return this.users.manager.transaction(async manager => {
      const user = await manager.findOne(User, { where: { id: dto.userId, isActive: true }, lock: { mode: 'pessimistic_write' } });
      if (!user) throw new NotFoundException('Active user not found');
      const position = await manager.findOne(Position, {
        where: { id: dto.positionId, isActive: true },
        relations: { unit: { organization: true } },
      });
      if (!position) throw new NotFoundException('Active position not found');
      const organization = position.unit.organization;
      const tenantId = organization?.tenantId;
      if (!tenantId || !organization.isActive) throw new BadRequestException('Position must belong to an active organization');
      const tenant = await manager.findOne(Tenant, { where: { id: tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!tenant || tenant.status !== 'ACTIVE') throw new BadRequestException('Position must belong to an active tenant');
      const tenantMember = await manager.findOne(TenantMembership, {
        where: { tenantId, userId: user.id, isActive: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!tenantMember) throw new ForbiddenException('User must be an active member of the position tenant');

      const validFrom = dto.validFrom ? new Date(dto.validFrom) : new Date();
      const validUntil = dto.validUntil ? new Date(dto.validUntil) : null;
      if (validUntil && validUntil <= validFrom) throw new BadRequestException('validUntil must be later than validFrom');
      if (dto.isPrimary) {
        await manager.update(UserPosition, { userId: user.id, tenantId, isActive: true }, { isPrimary: false });
      }
      return manager.save(UserPosition, manager.create(UserPosition, {
        userId: user.id, positionId: position.id, tenantId, validFrom, validUntil,
        isPrimary: dto.isPrimary ?? false,
      }));
    });
  }
  async listOrganizationUsers(organizationId: string, tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const organization = await this.organizations.findOne({ where: { id: organizationId, tenantId, isActive: true } });
    if (!organization) throw new NotFoundException('Organization not found');
    return this.users.createQueryBuilder('user')
      .distinct(true)
      .innerJoin('user.positions', 'membership',
        'membership.isActive = true AND membership."validFrom" <= CURRENT_TIMESTAMP AND (membership."validUntil" IS NULL OR membership."validUntil" >= CURRENT_TIMESTAMP)')
      .innerJoin('membership.position', 'position', 'position.isActive = true')
      .innerJoin('position.unit', 'unit', 'unit.isActive = true AND unit."organizationId" = :organizationId', { organizationId })
      .innerJoin('unit.organization', 'organization',
        'organization.id = :organizationId AND organization."tenantId" = :tenantId AND organization."isActive" = true',
        { organizationId, tenantId })
      .innerJoin('tenant_memberships', 'tm',
        'tm."userId" = user.id AND tm."tenantId" = :tenantId AND tm."isActive" = true',
        { tenantId })
      .innerJoin('tenants', 'tenant', 'tenant.id = :tenantId AND tenant.status = :tenantStatus', {
        tenantId, tenantStatus: 'ACTIVE',
      })
      .where('user.isActive = true')
      .select(['user.id', 'user.firstName', 'user.lastName', 'user.username', 'user.email'])
      .orderBy('user.lastName', 'ASC').addOrderBy('user.firstName', 'ASC')
      .getMany();
  }

  async listUserPositions(userId: string, tenantId?: string | null) {
    if (!await this.users.exist({ where: { id: userId } })) throw new NotFoundException('User not found');
    const query = this.memberships.createQueryBuilder('membership')
      .innerJoin('membership.user', 'user')
      .innerJoinAndSelect('membership.position', 'position')
      .innerJoinAndSelect('position.unit', 'unit')
      .where('membership.userId = :userId AND membership.isActive = true', { userId });
    if (tenantId) {
      query
        .innerJoin('unit.organization', 'organization',
          'organization.tenantId = :tenantId AND organization.isActive = true', { tenantId })
        .innerJoin('tenant_memberships', 'tenantMembership',
          'tenantMembership."userId" = membership."userId" AND tenantMembership."tenantId" = :tenantId AND tenantMembership."isActive" = true', { tenantId })
        .innerJoin('tenants', 'tenant', 'tenant.id = :tenantId AND tenant.status = :activeTenantStatus', {
          tenantId, activeTenantStatus: 'ACTIVE',
        })
        .andWhere('membership.tenantId = :tenantId', { tenantId })
        .andWhere('user.isActive = true');
    }
    return query.orderBy('membership.isPrimary', 'DESC').addOrderBy('membership.validFrom', 'DESC').getMany();
  }
  async createPermission(dto: CreatePermissionDto) {
    if (await this.permissions.findOneBy({ code: dto.code })) throw new ConflictException('Permission code already exists');
    return this.permissions.save(this.permissions.create({ ...dto, description: dto.description ?? null }));
  }
  listPermissions() { return this.permissions.find({ order: { code: 'ASC' } }); }
  async createRole(dto: CreateRoleDto) {
    if (await this.roles.findOneBy({ code: dto.code })) throw new ConflictException('Role code already exists');
    const permissions = dto.permissionIds?.length ? await this.permissions.findByIds(dto.permissionIds) : [];
    if (dto.permissionIds?.length && permissions.length !== dto.permissionIds.length) throw new BadRequestException('One or more permissions were not found');
    return this.roles.save(this.roles.create({ code: dto.code, name: dto.name, description: dto.description ?? null, permissions }));
  }
  listRoles() { return this.roles.find({ where: { isActive: true }, relations: { permissions: true }, order: { name: 'ASC' } }); }
  async grantRole(actorUserId: string, userId: string, roleId: string, organizationId?: string) {
    if (!await this.users.exist({ where: { id: userId, isActive: true } })) throw new NotFoundException('Active user not found');
    const role = await this.roles.findOne({ where: { id: roleId, isActive: true } });
    if (!role) throw new NotFoundException('Active role not found');

    if (role.scope === 'PLATFORM') {
      const actorIsPlatformOperator = await this.userRoles.createQueryBuilder('assignment')
        .innerJoin('assignment.role', 'role')
        .innerJoin('role.permissions', 'permission')
        .where('assignment.userId = :actorUserId', { actorUserId })
        .andWhere('assignment.isActive = true')
        .andWhere('role.isActive = true')
        .andWhere('role.scope = :scope', { scope: 'PLATFORM' })
        .andWhere('permission.code IN (:...codes)', { codes: ['*', 'assignments.manage'] })
        .getCount() > 0;
      if (!actorIsPlatformOperator || organizationId) throw new ForbiddenException('Only platform operators may grant platform roles, and platform roles cannot be organization-scoped');
    } else {
      if (!organizationId) throw new BadRequestException('Organization roles must be assigned to an organization');
      const organization = await this.organizations.findOne({ where: { id: organizationId, isActive: true }, relations: { tenant: true } });
      if (!organization || !organization.tenant || organization.tenant.status !== 'ACTIVE') throw new NotFoundException('Active organization not found');
      const tenantMember = await this.users.manager.getRepository(TenantMembership).exist({ where: { tenantId: organization.tenantId, userId, isActive: true } });
      if (!tenantMember) throw new ForbiddenException('Role recipient must be an active member of the organization tenant');
    }

    const existing = await this.userRoles.findOne({ where: { userId, roleId, organizationId: organizationId ?? IsNull() } });
    if (existing) { existing.isActive = true; return this.userRoles.save(existing); }
    return this.userRoles.save(this.userRoles.create({ userId, roleId, organizationId: organizationId ?? null }));
  }
}