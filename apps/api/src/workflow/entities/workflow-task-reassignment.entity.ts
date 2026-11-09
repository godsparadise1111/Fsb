import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('workflow_task_reassignments')
export class WorkflowTaskReassignment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') tenantId: string;
  @Column('uuid') taskId: string;
  @Column({ type: 'varchar', length: 30 }) triggerType: 'SLA' | 'INACTIVE_ASSIGNEE' | 'MANUAL';
  @Column({ type: 'jsonb' }) fromUserIds: string[];
  @Column({ type: 'jsonb' }) toUserIds: string[];
  @Column({ type: 'varchar', length: 1000 }) reason: string;
  @CreateDateColumn() createdAt: Date;
}
