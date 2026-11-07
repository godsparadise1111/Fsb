import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Tenant } from './entities/tenant.entity';
import { TenantMembership } from './entities/tenant-membership.entity';
import { User } from '../identity/entities/user.entity';

@Injectable()
export class TenantMembershipService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(TenantMembership) private readonly memberships: Repository<TenantMembership>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async add(tenantId: string, userId: string, isTenantAdmin = false) {
    return this.dataSource.transaction(async manager => {
      const tenant = await manager.findOne(Tenant, { where: { id: tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!tenant) throw new NotFoundException('Tenant not found');
      if (tenant.status !== 'ACTIVE') throw new BadRequestException('Membership can only be created for an active tenant');
      if (!await manager.getRepository(User).exist({ where: { id: userId, isActive: true } })) {
        throw new NotFoundException('Active user not found');
      }

      const repository = manager.getRepository(TenantMembership);
      const existing = await repository.findOne({ where: { tenantId, userId }, lock: { mode: 'pessimistic_write' } });
      if (existing) {
        if (existing.isActive) throw new ConflictException('User is already an active member of this tenant');
        existing.isActive = true;
        existing.isTenantAdmin = isTenantAdmin;
        existing.acceptedAt = new Date();
        return repository.save(existing);
      }
      return repository.save(repository.create({
        tenantId, userId, isActive: true, isTenantAdmin, acceptedAt: new Date(),
      }));
    });
  }

  async list(tenantId: string) {
    return this.memberships.find({
      where: { tenantId, isActive: true },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });
  }

  async setAdmin(tenantId: string, userId: string, isTenantAdmin: boolean) {
    return this.dataSource.transaction(async manager => {
      const tenant = await manager.findOne(Tenant, { where: { id: tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!tenant) throw new NotFoundException('Tenant not found');
      if (tenant.status !== 'ACTIVE') throw new BadRequestException('Tenant administration is unavailable while the tenant is not active');
      const repository = manager.getRepository(TenantMembership);
      const membership = await repository.findOne({
        where: { tenantId, userId, isActive: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!membership) throw new NotFoundException('Active tenant membership not found');
      if (membership.isTenantAdmin && !isTenantAdmin) {
        const admins = await repository.count({ where: { tenantId, isActive: true, isTenantAdmin: true } });
        if (admins <= 1) throw new BadRequestException('A tenant must retain at least one active administrator');
      }
      membership.isTenantAdmin = isTenantAdmin;
      return repository.save(membership);
    });
  }

  async remove(tenantId: string, userId: string) {
    return this.dataSource.transaction(async manager => {
      const tenant = await manager.findOne(Tenant, { where: { id: tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!tenant) throw new NotFoundException('Tenant not found');
      const repository = manager.getRepository(TenantMembership);
      const membership = await repository.findOne({
        where: { tenantId, userId, isActive: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!membership) throw new NotFoundException('Active tenant membership not found');
      if (membership.isTenantAdmin) {
        const admins = await repository.count({ where: { tenantId, isActive: true, isTenantAdmin: true } });
        if (admins <= 1) throw new BadRequestException('Transfer tenant administration before removing the last administrator');
      }
      membership.isActive = false;
      membership.isTenantAdmin = false;
      return repository.save(membership);
    });
  }
}
