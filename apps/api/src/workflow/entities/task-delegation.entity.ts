import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('task_delegations')
@Index('IDX_task_delegations_active_target', ['tenantId', 'toUserId', 'endsAt'])
@Index('IDX_task_delegations_task', ['tenantId', 'taskId', 'createdAt'])
export class TaskDelegation {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') tenantId: string;
  @Column('uuid') taskId: string;
  @Column('uuid') fromUserId: string;
  @Column('uuid') toUserId: string;
  @Column({ type: 'timestamptz' }) startsAt: Date;
  @Column({ type: 'timestamptz' }) endsAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) revokedAt: Date | null;
  @Column('uuid', { nullable: true }) revokedByUserId: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
