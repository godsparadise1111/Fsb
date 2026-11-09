import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { FormVersion } from './form-version.entity';
import { User } from '../../identity/entities/user.entity';
import { ProcessInstance } from '../../workflow/entities/process-instance.entity';

@Entity('form_submissions')
export class FormSubmission {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', insert: false, update: false }) tenantId: string;
  @Column('uuid') formVersionId: string;
  @ManyToOne(() => FormVersion, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'formVersionId' }) formVersion: FormVersion;
  @Column('uuid') submittedByUserId: string;
  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'submittedByUserId' }) submittedBy: User;
  @Column('uuid', { nullable: true }) processInstanceId: string | null;
  @ManyToOne(() => ProcessInstance, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'processInstanceId' }) processInstance: ProcessInstance | null;
  @Column({ type: 'jsonb' }) data: Record<string, unknown>;
  @CreateDateColumn() submittedAt: Date;
}