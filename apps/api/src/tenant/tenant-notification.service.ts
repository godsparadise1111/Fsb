import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { NotificationOutbox } from '../notifications/entities/notification-outbox.entity';
import { Tenant } from './entities/tenant.entity';
import { TenantAuditService } from './tenant-audit.service';

@Injectable()
export class TenantNotificationService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(NotificationOutbox) private readonly outbox: Repository<NotificationOutbox>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly audit: TenantAuditService,
  ) {}

  async listDead(tenantId: string, requestedLimit = 50) {
    const tenant = await this.tenants.findOne({ where: { id: tenantId, status: 'ACTIVE' } });
    if (!tenant) throw new NotFoundException('Active tenant not found');
    const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.trunc(requestedLimit))) : 50;
    return this.outbox.find({
      where: { tenantId, status: 'DEAD' },
      select: { id: true, tenantId: true, eventType: true, recipient: true, subject: true, status: true, attempts: true, availableAt: true, lastError: true, createdAt: true, updatedAt: true },
      order: { updatedAt: 'DESC' },
      take: limit,
    });
  }

  async retryDead(tenantId: string, notificationId: string, actorUserId: string) {
    return this.dataSource.transaction(async manager => {
      const tenant = await manager.findOne(Tenant, { where: { id: tenantId }, lock: { mode: 'pessimistic_read' } });
      if (!tenant || tenant.status !== 'ACTIVE') throw new BadRequestException('Only active tenants can retry notifications');
      const repository = manager.getRepository(NotificationOutbox);
      const notification = await repository.findOne({
        where: { id: notificationId, tenantId, status: 'DEAD' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!notification) throw new NotFoundException('Dead notification not found');
      const previousAttempts = notification.attempts;
      notification.status = 'PENDING';
      notification.attempts = 0;
      notification.availableAt = new Date();
      notification.lockedAt = null;
      notification.lockedBy = null;
      notification.lastError = null;
      await repository.save(notification);
      await this.audit.record(manager, {
        tenantId, actorUserId, action: 'NOTIFICATION_REQUEUED',
        resourceType: 'NOTIFICATION_OUTBOX', resourceId: notification.id,
        metadata: { eventType: notification.eventType, previousAttempts },
      });
      return { id: notification.id, status: notification.status, queued: true };
    });
  }
}
