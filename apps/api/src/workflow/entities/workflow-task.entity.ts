import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ProcessInstance } from './process-instance.entity';
import { User } from '../../identity/entities/user.entity';
import { TaskAssignee } from './task-assignee.entity';

@Entity('workflow_tasks')
export class WorkflowTask {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', insert: false, update: false }) tenantId: string;
  @Column('uuid') processInstanceId: string;
  @ManyToOne(() => ProcessInstance, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'processInstanceId' }) processInstance: ProcessInstance;
  @Column({ length: 200 }) title: string;
  @Column({ type: 'text', nullable: true }) instructions: string | null;
  @Column({ default: 'ALL_ASSIGNEES', length: 20 }) assignmentPolicy: 'ANY_ASSIGNEE' | 'ALL_ASSIGNEES';
  @Column({ default: 'OPEN', length: 20 }) status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'RETURNED';
  @Column('uuid') createdByUserId: string;
  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'createdByUserId' }) createdBy: User;
  @OneToMany(() => TaskAssignee, assignee => assignee.task) assignees: TaskAssignee[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) completedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) dueAt: Date | null;
}