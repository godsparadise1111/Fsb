import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Tenant } from './entities/tenant.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantAuditService } from './tenant-audit.service';

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

  async changeStatus(id: string, status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED', actorUserId: string) {
    return this.dataSource.transaction(async manager => {
      const tenant = await manager.findOne(Tenant, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!tenant) throw new NotFoundException('Tenant not found');
      if (tenant.status === 'CLOSED' && status !== 'CLOSED') {
        throw new BadRequestException('Closed tenants cannot be reactivated; create a new tenant contract');
      }
      if (tenant.status === 'PENDING' && status === 'SUSPENDED') {
        throw new BadRequestException('A pending tenant cannot be suspended before activation');
      }
      const previousStatus = tenant.status;
      if (previousStatus === status) return tenant;
      tenant.status = status;
      if (status === 'ACTIVE' && !tenant.activatedAt) tenant.activatedAt = new Date();
      if (status === 'SUSPENDED') tenant.suspendedAt = new Date();
      if (status === 'ACTIVE') tenant.suspendedAt = null;
      const saved = await manager.save(tenant);
      await this.audit.record(manager, { tenantId: tenant.id, actorUserId, action: 'TENANT_STATUS_CHANGED', resourceType: 'TENANT', resourceId: tenant.id, metadata: { from: previousStatus, to: status } });
      return saved;
    });
  }
}
