import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { WorkflowTask } from './workflow-task.entity';
import { User } from '../../identity/entities/user.entity';

@Entity('workflow_action_logs')
export class WorkflowActionLog {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', insert: false, update: false }) tenantId: string;
  @Column('uuid') taskId: string;
  @ManyToOne(() => WorkflowTask, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'taskId' }) task: WorkflowTask;
  @Column('uuid') userId: string;
  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' }) user: User;
  @Column({ length: 30 }) action: string;
  @Column({ type: 'text', nullable: true }) comment: string | null;
  @Column({ type: 'integer', nullable: true }) returnToStepIndex: number | null;
  @CreateDateColumn() createdAt: Date;
}