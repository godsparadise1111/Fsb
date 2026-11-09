import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Tenant } from './entities/tenant.entity';
import { TenantMembership } from './entities/tenant-membership.entity';
import { User } from '../identity/entities/user.entity';
import { TenantAuditService } from './tenant-audit.service';

@Injectable()
export class TenantMembershipService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(TenantMembership) private readonly memberships: Repository<TenantMembership>,
    private readonly audit: TenantAuditService,
  ) {}

  async add(tenantId: string, userId: string, actorUserId: string, isTenantAdmin = false) {
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
        const saved = await repository.save(existing);
        await this.audit.record(manager, { tenantId, actorUserId, targetUserId: userId, action: 'MEMBER_REACTIVATED', resourceType: 'TENANT_MEMBERSHIP', resourceId: saved.id, metadata: { isTenantAdmin } });
        return saved;
      }
      const saved = await repository.save(repository.create({
        tenantId, userId, isActive: true, isTenantAdmin, acceptedAt: new Date(),
      }));
      await this.audit.record(manager, { tenantId, actorUserId, targetUserId: userId, action: 'MEMBER_ADDED', resourceType: 'TENANT_MEMBERSHIP', resourceId: saved.id, metadata: { isTenantAdmin } });
      return saved;
    });
  }

  async list(tenantId: string) {
    return this.memberships.find({
      where: { tenantId, isActive: true },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });
  }

  async setAdmin(tenantId: string, userId: string, actorUserId: string, isTenantAdmin: boolean) {
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
        const admins = await repository.createQueryBuilder('admin')
          .innerJoin('admin.user', 'adminUser', 'adminUser.isActive = true')
          .where('admin.tenantId = :tenantId AND admin.isActive = true AND admin.isTenantAdmin = true', { tenantId })
          .getCount();
        if (admins <= 1) throw new BadRequestException('A tenant must retain at least one active administrator');
      }
      const previous = membership.isTenantAdmin;
      membership.isTenantAdmin = isTenantAdmin;
      const saved = await repository.save(membership);
      if (previous !== isTenantAdmin) await this.audit.record(manager, { tenantId, actorUserId, targetUserId: userId, action: isTenantAdmin ? 'ADMIN_PROMOTED' : 'ADMIN_DEMOTED', resourceType: 'TENANT_MEMBERSHIP', resourceId: saved.id });
      return saved;
    });
  }

  async remove(tenantId: string, userId: string, actorUserId: string) {
    return this.dataSource.transaction(async manager => {
      const tenant = await manager.findOne(Tenant, { where: { id: tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!tenant) throw new NotFoundException('Tenant not found');
      const repository = manager.getRepository(TenantMembership);
      const membership = await repository.findOne({
        where: { tenantId, userId, isActive: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!membership) throw new NotFoundException('Active tenant membership not found');
      if (membership.isTenantAdmin && tenant.status === 'ACTIVE') {
        const admins = await repository.createQueryBuilder('admin')
          .innerJoin('admin.user', 'adminUser', 'adminUser.isActive = true')
          .where('admin.tenantId = :tenantId AND admin.isActive = true AND admin.isTenantAdmin = true', { tenantId })
          .getCount();
        if (admins <= 1) throw new BadRequestException('Transfer tenant administration before removing the last active administrator');
      }
      membership.isActive = false;
      membership.isTenantAdmin = false;
      const saved = await repository.save(membership);
      await this.audit.record(manager, { tenantId, actorUserId, targetUserId: userId, action: 'MEMBER_REMOVED', resourceType: 'TENANT_MEMBERSHIP', resourceId: saved.id });
      return saved;
    });
  }
}
