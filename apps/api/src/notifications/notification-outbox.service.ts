import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { NotificationOutbox } from './entities/notification-outbox.entity';

export interface EnqueueNotificationInput {
  tenantId: string;
  eventType: string;
  recipient: string;
  subject?: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}

@Injectable()
export class NotificationOutboxService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(NotificationOutbox) private readonly outbox: Repository<NotificationOutbox>,
  ) {}

  private encryptionKey(): Buffer {
    const configured = process.env.FSB_OUTBOX_ENCRYPTION_KEY;
    if (!configured) throw new ServiceUnavailableException('Notification outbox encryption key is not configured');
    let key: Buffer;
    if (/^[a-f0-9]{64}$/i.test(configured)) key = Buffer.from(configured, 'hex');
    else {
      try { key = Buffer.from(configured, 'base64'); }
      catch { throw new ServiceUnavailableException('Notification outbox encryption key must be 32 bytes'); }
    }
    if (key.length !== 32) throw new ServiceUnavailableException('Notification outbox encryption key must decode to exactly 32 bytes');
    return key;
  }

  private encrypt(payload: Record<string, unknown>) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    return { payloadCiphertext: ciphertext.toString('base64'), payloadIv: iv.toString('hex'), payloadAuthTag: cipher.getAuthTag().toString('hex') };
  }

  private decrypt(row: NotificationOutbox): Record<string, unknown> {
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), Buffer.from(row.payloadIv, 'hex'));
    decipher.setAuthTag(Buffer.from(row.payloadAuthTag, 'hex'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(row.payloadCiphertext, 'base64')), decipher.final()]).toString('utf8');
    return JSON.parse(plaintext) as Record<string, unknown>;
  }

  async enqueue(manager: EntityManager, input: EnqueueNotificationInput) {
    const encrypted = this.encrypt(input.payload);
    const repository = manager.getRepository(NotificationOutbox);
    const existing = await repository.findOneBy({ dedupeKey: input.dedupeKey });
    if (existing) return existing;
    return repository.save(repository.create({
      tenantId: input.tenantId,
      eventType: input.eventType,
      recipient: input.recipient.trim().toLowerCase(),
      subject: input.subject ?? null,
      ...encrypted,
      dedupeKey: input.dedupeKey,
      status: 'PENDING',
      attempts: 0,
      availableAt: new Date(),
    }));
  }

  async claimBatch(workerId: string, limit = 20) {
    if (!/^[a-zA-Z0-9._:-]{3,120}$/.test(workerId)) throw new Error('Invalid worker id');
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const rows = await this.dataSource.transaction(async manager => manager.query(
      `WITH candidates AS (
         SELECT id FROM notification_outbox
          WHERE (status = 'PENDING' AND "availableAt" <= now())
             OR (status = 'PROCESSING' AND "lockedAt" < now() - interval '2 minutes')
          ORDER BY "availableAt", "createdAt"
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       UPDATE notification_outbox o
          SET status = 'PROCESSING', "lockedBy" = $2, "lockedAt" = now(),
              attempts = o.attempts + 1, "updatedAt" = now()
         FROM candidates c
        WHERE o.id = c.id
       RETURNING o.*`,
      [safeLimit, workerId],
    )) as NotificationOutbox[];
    return rows.map(row => ({
      id: row.id,
      tenantId: row.tenantId,
      eventType: row.eventType,
      recipient: row.recipient,
      subject: row.subject,
      payload: this.decrypt(row),
      attempts: row.attempts,
    }));
  }

  async markDelivered(id: string, workerId: string) {
    const result = await this.outbox.createQueryBuilder().update()
      .set({ status: 'DELIVERED', deliveredAt: new Date(), lockedAt: null, lockedBy: null, lastError: null })
      .where('id = :id AND status = :status AND "lockedBy" = :workerId', { id, status: 'PROCESSING', workerId })
      .execute();
    return result.affected === 1;
  }

  async scheduleRetry(id: string, workerId: string, error: unknown) {
    const row = await this.outbox.findOneBy({ id, status: 'PROCESSING', lockedBy: workerId });
    if (!row) return false;
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    const dead = row.attempts >= 10;
    const delaySeconds = Math.min(6 * 60 * 60, 30 * (2 ** Math.min(row.attempts - 1, 10)));
    const result = await this.outbox.createQueryBuilder().update()
      .set({
        status: dead ? 'DEAD' : 'PENDING',
        availableAt: new Date(Date.now() + delaySeconds * 1000),
        lockedAt: null,
        lockedBy: null,
        lastError: message,
      })
      .where('id = :id AND status = :status AND "lockedBy" = :workerId', { id, status: 'PROCESSING', workerId })
      .execute();
    return result.affected === 1;
  }

  async getDeliveryPayload(id: string, workerId: string) {
    const row = await this.outbox.findOneBy({ id, status: 'PROCESSING', lockedBy: workerId });
    if (!row) return null;
    return this.decrypt(row);
  }
}
