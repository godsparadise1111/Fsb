import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UserPosition } from './entities/user-position.entity';
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { UserRole } from './entities/user-role.entity';
import { Position } from '../organization/entities/position.entity';
import { Organization } from '../organization/entities/organization.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { AssignPositionDto } from './dto/assign-position.dto';
import { CreateRoleDto } from './dto/create-role.dto';

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
    return this.users.save(this.users.create({ ...dto, email: dto.email.toLowerCase() }));
  }
  listUsers() { return this.users.find({ where: { isActive: true }, order: { lastName: 'ASC', firstName: 'ASC' } }); }
  async setUserActive(id: string, isActive: boolean) {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('User not found');
    user.isActive = isActive;
    return this.users.save(user);
  }
  async assignPosition(dto: AssignPositionDto) {
    const user = await this.users.findOneBy({ id: dto.userId, isActive: true });
    if (!user) throw new NotFoundException('Active user not found');
    const position = await this.positions.findOne({ where: { id: dto.positionId, isActive: true } });
    if (!position) throw new NotFoundException('Active position not found');
    const validFrom = dto.validFrom ? new Date(dto.validFrom) : new Date();
    const validUntil = dto.validUntil ? new Date(dto.validUntil) : null;
    if (validUntil && validUntil <= validFrom) throw new BadRequestException('validUntil must be later than validFrom');
    if (dto.isPrimary) await this.memberships.update({ userId: user.id, isActive: true }, { isPrimary: false });
    return this.memberships.save(this.memberships.create({ userId: user.id, positionId: position.id, validFrom, validUntil, isPrimary: dto.isPrimary ?? false }));
  }
  async listUserPositions(userId: string) {
    if (!await this.users.exist({ where: { id: userId } })) throw new NotFoundException('User not found');
    return this.memberships.find({ where: { userId, isActive: true }, relations: { position: { unit: true } }, order: { isPrimary: 'DESC', validFrom: 'DESC' } });
  }
  async createRole(dto: CreateRoleDto) {
    if (await this.roles.findOneBy({ code: dto.code })) throw new ConflictException('Role code already exists');
    const permissions = dto.permissionIds?.length ? await this.permissions.findByIds(dto.permissionIds) : [];
    if (dto.permissionIds?.length && permissions.length !== dto.permissionIds.length) throw new BadRequestException('One or more permissions were not found');
    return this.roles.save(this.roles.create({ code: dto.code, name: dto.name, description: dto.description ?? null, permissions }));
  }
  listRoles() { return this.roles.find({ where: { isActive: true }, relations: { permissions: true }, order: { name: 'ASC' } }); }
  async grantRole(userId: string, roleId: string, organizationId?: string) {
    if (!await this.users.exist({ where: { id: userId, isActive: true } })) throw new NotFoundException('Active user not found');
    if (!await this.roles.exist({ where: { id: roleId, isActive: true } })) throw new NotFoundException('Active role not found');
    if (organizationId && !await this.organizations.exist({ where: { id: organizationId, isActive: true } })) throw new NotFoundException('Organization not found');
    const existing = await this.userRoles.findOne({ where: { userId, roleId, organizationId: organizationId ?? IsNull() } });
    if (existing) { existing.isActive = true; return this.userRoles.save(existing); }
    return this.userRoles.save(this.userRoles.create({ userId, roleId, organizationId: organizationId ?? null }));
  }
}