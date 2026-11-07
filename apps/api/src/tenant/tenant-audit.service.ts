import { Injectable } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { TenantAuditLog } from './entities/tenant-audit-log.entity';

export interface TenantAuditInput {
  tenantId: string;
  actorUserId: string;
  targetUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class TenantAuditService {
  constructor(@InjectRepository(TenantAuditLog) private readonly logs: Repository<TenantAuditLog>) {}

  record(manager: EntityManager, input: TenantAuditInput) {
    const repository = manager.getRepository(TenantAuditLog);
    return repository.save(repository.create({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      metadata: input.metadata ?? null,
    }));
  }

  list(tenantId: string, limit = 50) {
    return this.logs.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      take: Math.min(100, Math.max(1, Math.floor(limit))),
    });
  }
}
