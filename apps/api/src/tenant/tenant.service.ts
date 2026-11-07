import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from './entities/tenant.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';

@Injectable()
export class TenantService {
  constructor(@InjectRepository(Tenant) private readonly tenants: Repository<Tenant>) {}

  async create(dto: CreateTenantDto) {
    if (await this.tenants.findOne({ where: [{ slug: dto.slug }, { code: dto.code }] })) {
      throw new ConflictException('Tenant slug or code already exists');
    }
    return this.tenants.save(this.tenants.create({
      ...dto,
      plan: dto.plan ?? 'CORE',
      status: 'PENDING',
      settings: {},
    }));
  }

  async list() {
    return this.tenants.find({ order: { createdAt: 'DESC' } });
  }

  async get(id: string) {
    const tenant = await this.tenants.findOne({ where: { id }, relations: { organizations: true } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async changeStatus(id: string, status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED') {
    const tenant = await this.tenants.findOneBy({ id });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status === 'CLOSED' && status !== 'CLOSED') {
      throw new BadRequestException('Closed tenants cannot be reactivated; create a new tenant contract');
    }
    if (tenant.status === 'PENDING' && status === 'SUSPENDED') {
      throw new BadRequestException('A pending tenant cannot be suspended before activation');
    }
    tenant.status = status;
    if (status === 'ACTIVE' && !tenant.activatedAt) tenant.activatedAt = new Date();
    if (status === 'SUSPENDED') tenant.suspendedAt = new Date();
    if (status === 'ACTIVE') tenant.suspendedAt = null;
    return this.tenants.save(tenant);
  }
}
