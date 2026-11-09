import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Tenant } from './entities/tenant.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantAuditService } from './tenant-audit.service';
import { User } from '../identity/entities/user.entity';
import { TenantMembership } from './entities/tenant-membership.entity';

@Injectable()
export class TenantService {
  constructor(private readonly dataSource: DataSource, @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>, private readonly audit: TenantAuditService) {}

  async create(dto: CreateTenantDto, actorUserId: string) {
    return this.dataSource.transaction(async manager => {
      const repository = manager.getRepository(Tenant);
      if (await repository.findOne({ where: [{ slug: dto.slug }, { code: dto.code }] })) {
        throw new ConflictException('Tenant slug or code already exists');
      }
      const tenant = await repository.save(repository.create({
        ...dto, plan: dto.plan ?? 'CORE', status: 'PENDING', settings: {},
      }));
      await manager.query(
        `INSERT INTO tenant_subscriptions
          ("tenantId","planCode",status,"billingCycle","startsAt","currentPeriodStart","createdByUserId")
         VALUES ($1,$2,'TRIALING','MONTHLY',now(),now(),$3)
         ON CONFLICT ("tenantId") DO NOTHING`,
        [tenant.id, tenant.plan, actorUserId],
      );
      await this.audit.record(manager, { tenantId: tenant.id, actorUserId, action: 'TENANT_CREATED', resourceType: 'TENANT', resourceId: tenant.id, metadata: { plan: tenant.plan, status: tenant.status } });
      return tenant;
    });
  }

  async list() {
    return this.tenants.find({ order: { createdAt: 'DESC' } });
  }

  async get(id: string) {
    const tenant = await this.tenants.findOne({ where: { id }, relations: { organizations: true } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async changeStatus(
    id: string,
    status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED',
    actorUserId: string,
    initialAdminUserId?: string,
  ) {
    return this.dataSource.transaction(async manager => {
      // Lock the proposed administrator before the tenant row, matching the
      // user -> tenant lock order used by account deactivation.
      const initialAdminUser = initialAdminUserId
        ? await manager.findOne(User, {
            where: { id: initialAdminUserId, isActive: true },
            lock: { mode: 'pessimistic_write' },
          })
        : null;
      if (initialAdminUserId && !initialAdminUser) {
        throw new NotFoundException('Active initial tenant administrator user not found');
      }
      const tenant = await manager.findOne(Tenant, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!tenant) throw new NotFoundException('Tenant not found');
      if (tenant.status === 'CLOSED' && status !== 'CLOSED') {
        throw new BadRequestException('Closed tenants cannot be reactivated; create a new tenant contract');
      }
      if (tenant.status === 'PENDING' && status === 'SUSPENDED') {
        throw new BadRequestException('A pending tenant cannot be suspended before activation');
      }
      if (status !== 'ACTIVE' && initialAdminUserId) {
        throw new BadRequestException('initialAdminUserId is only valid when activating a tenant');
      }

      const previousStatus = tenant.status;
      let activeAdminCount = 0;
      if (status === 'ACTIVE') {
        activeAdminCount = await manager.getRepository(TenantMembership).createQueryBuilder('membership')
          .innerJoin('membership.user', 'user', 'user.isActive = true')
          .where('membership.tenantId = :tenantId AND membership.isActive = true AND membership.isTenantAdmin = true', {
            tenantId: tenant.id,
          })
          .getCount();
        if (activeAdminCount === 0 && !initialAdminUserId) {
          throw new BadRequestException('Select an active initial tenant administrator before activation');
        }
        if (activeAdminCount > 0 && initialAdminUserId) {
          throw new BadRequestException('This tenant already has an active administrator; omit initialAdminUserId');
        }
      }

      if (previousStatus === status && !(status === 'ACTIVE' && activeAdminCount === 0)) return tenant;
      tenant.status = status;
      if (status === 'ACTIVE' && !tenant.activatedAt) tenant.activatedAt = new Date();
      if (status === 'ACTIVE') {
        await manager.query(
          `UPDATE tenant_subscriptions
              SET "currentPeriodStart"=CASE WHEN status='TRIALING' AND "trialEndsAt" IS NULL THEN now() ELSE "currentPeriodStart" END,
                  "trialEndsAt"=CASE WHEN status='TRIALING' AND "trialEndsAt" IS NULL THEN now() + interval '14 days' ELSE "trialEndsAt" END,
                  "updatedAt"=now()
            WHERE "tenantId"=$1`,
          [tenant.id],
        );
      }
      if (status === 'SUSPENDED') tenant.suspendedAt = new Date();
      if (status === 'ACTIVE') tenant.suspendedAt = null;
      const saved = await manager.save(tenant);

      if (status === 'ACTIVE' && activeAdminCount === 0 && initialAdminUserId) {
        const user = initialAdminUser;
        if (!user) throw new NotFoundException('Active initial tenant administrator user not found');
        const memberships = manager.getRepository(TenantMembership);
        let membership = await memberships.findOne({
          where: { tenantId: tenant.id, userId: user.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (membership?.isActive && membership.isTenantAdmin) {
          throw new ConflictException('The selected user is already an active tenant administrator');
        }
        if (membership) {
          membership.isActive = true;
          membership.isTenantAdmin = true;
          membership.acceptedAt = new Date();
        } else {
          membership = memberships.create({
            tenantId: tenant.id, userId: user.id, isActive: true,
            isTenantAdmin: true, acceptedAt: new Date(),
          });
        }
        await memberships.save(membership);
        await this.audit.record(manager, {
          tenantId: tenant.id, actorUserId, targetUserId: user.id,
          action: 'INITIAL_ADMIN_ASSIGNED', resourceType: 'TENANT_MEMBERSHIP',
          resourceId: membership.id,
        });
      }

      if (previousStatus !== status) {
        await this.audit.record(manager, {
          tenantId: tenant.id, actorUserId, action: 'TENANT_STATUS_CHANGED',
          resourceType: 'TENANT', resourceId: tenant.id,
          metadata: { from: previousStatus, to: status },
        });
      }
      return saved;
    });
  }
}
