import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { WorkflowTask } from './workflow-task.entity';
import { User } from '../../identity/entities/user.entity';

@Entity('task_assignees')
@Unique('UQ_task_assignee_user', ['taskId', 'userId'])
export class TaskAssignee {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { insert: false, update: false }) tenantId: string;
  @Column('uuid') taskId: string;
  @ManyToOne(() => WorkflowTask, task => task.assignees, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'taskId' }) task: WorkflowTask;
  @Column('uuid') userId: string;
  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' }) user: User;
  @Column({ default: 'PENDING', length: 20 }) status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REASSIGNED';
  @Column({ type: 'text', nullable: true }) comment: string | null;
  @Column({ type: 'timestamptz', nullable: true }) actedAt: Date | null;
  @CreateDateColumn() assignedAt: Date;
}