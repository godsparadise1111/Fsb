import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('task_deferral_requests')
@Index('IDX_task_deferral_requests_task', ['tenantId', 'taskId', 'createdAt'])
@Index('IDX_task_deferral_requests_pending', ['tenantId', 'status', 'createdAt'])
export class TaskDeferralRequest {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') tenantId: string;
  @Column('uuid') taskId: string;
  @Column('uuid') requesterUserId: string;
  @Column({ type: 'timestamptz', nullable: true }) originalDueAt: Date | null;
  @Column({ type: 'timestamptz' }) proposedDueAt: Date;
  @Column({ type: 'varchar', length: 1000 }) reason: string;
  @Column({ type: 'varchar', length: 20, default: 'PENDING' }) status: 'PENDING' | 'APPROVED' | 'REJECTED';
  @Column('uuid', { nullable: true }) reviewerUserId: string | null;
  @Column({ type: 'timestamptz', nullable: true }) reviewedAt: Date | null;
  @Column({ type: 'varchar', length: 1000, nullable: true }) reviewerComment: string | null;
  @CreateDateColumn() createdAt: Date;
}
