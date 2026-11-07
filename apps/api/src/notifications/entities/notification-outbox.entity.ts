import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'DELIVERED' | 'DEAD';

@Entity('notification_outbox')
@Index('UQ_notification_outbox_dedupe', ['dedupeKey'], { unique: true })
@Index('IDX_notification_outbox_ready', ['status', 'availableAt', 'createdAt'])
@Index('IDX_notification_outbox_tenant', ['tenantId', 'createdAt'])
export class NotificationOutbox {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') tenantId: string;
  @Column({ length: 80 }) eventType: string;
  @Column({ length: 190 }) recipient: string;
  @Column({ length: 160, nullable: true }) subject: string | null;
  @Column({ type: 'text' }) payloadCiphertext: string;
  @Column({ length: 64 }) payloadIv: string;
  @Column({ length: 64 }) payloadAuthTag: string;
  @Column({ length: 80, unique: true }) dedupeKey: string;
  @Column({ type: 'varchar', length: 20, default: 'PENDING' }) status: OutboxStatus;
  @Column({ type: 'integer', default: 0 }) attempts: number;
  @Column({ type: 'timestamptz', default: () => 'now()' }) availableAt: Date;
  @Column({ type: 'varchar', length: 120, nullable: true }) lockedBy: string | null;
  @Column({ type: 'timestamptz', nullable: true }) lockedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) deliveredAt: Date | null;
  @Column({ type: 'text', nullable: true }) lastError: string | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
