import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from './entities/tenant.entity';
import { TenantMembership } from './entities/tenant-membership.entity';
import { User } from '../identity/entities/user.entity';

@Injectable()
export class TenantMembershipService {
  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(TenantMembership) private readonly memberships: Repository<TenantMembership>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async add(tenantId: string, userId: string, isTenantAdmin = false) {
    const tenant = await this.tenants.findOneBy({ id: tenantId });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status !== 'ACTIVE') throw new BadRequestException('Membership can only be created for an active tenant');
    if (!await this.users.exist({ where: { id: userId, isActive: true } })) throw new NotFoundException('Active user not found');
    const existing = await this.memberships.findOneBy({ tenantId, userId });
    if (existing) {
      if (existing.isActive) throw new ConflictException('User is already an active member of this tenant');
      existing.isActive = true;
      existing.isTenantAdmin = isTenantAdmin;
      existing.acceptedAt = new Date();
      return this.memberships.save(existing);
    }
    return this.memberships.save(this.memberships.create({ tenantId, userId, isActive: true, isTenantAdmin, acceptedAt: new Date() }));
  }

  async list(tenantId: string) {
    return this.memberships.find({ where: { tenantId, isActive: true }, relations: { user: true }, order: { createdAt: 'ASC' } });
  }

  async setAdmin(tenantId: string, userId: string, isTenantAdmin: boolean) {
    const membership = await this.memberships.findOneBy({ tenantId, userId, isActive: true });
    if (!membership) throw new NotFoundException('Active tenant membership not found');
    if (membership.isTenantAdmin && !isTenantAdmin) {
      const admins = await this.memberships.count({ where: { tenantId, isActive: true, isTenantAdmin: true } });
      if (admins <= 1) throw new BadRequestException('A tenant must retain at least one active administrator');
    }
    membership.isTenantAdmin = isTenantAdmin;
    return this.memberships.save(membership);
  }

  async remove(tenantId: string, userId: string) {
    const membership = await this.memberships.findOneBy({ tenantId, userId, isActive: true });
    if (!membership) throw new NotFoundException('Active tenant membership not found');
    if (membership.isTenantAdmin) {
      const admins = await this.memberships.count({ where: { tenantId, isActive: true, isTenantAdmin: true } });
      if (admins <= 1) throw new BadRequestException('Transfer tenant administration before removing the last administrator');
    }
    membership.isActive = false;
    membership.isTenantAdmin = false;
    return this.memberships.save(membership);
  }
}
