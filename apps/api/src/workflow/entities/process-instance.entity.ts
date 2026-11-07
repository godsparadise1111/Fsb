import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ProcessVersion } from '../../process/entities/process-version.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { User } from '../../identity/entities/user.entity';

@Entity('process_instances')
export class ProcessInstance {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { insert: false, update: false }) tenantId: string;
  @Column('uuid') processVersionId: string;
  @ManyToOne(() => ProcessVersion, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'processVersionId' }) processVersion: ProcessVersion;
  @Column('uuid') organizationId: string;
  @ManyToOne(() => Organization, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organizationId' }) organization: Organization;
  @Column('uuid') startedByUserId: string;
  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'startedByUserId' }) startedBy: User;
  @Column({ length: 240 }) title: string;
  @Column({ default: 'RUNNING', length: 20 }) status: 'RUNNING' | 'COMPLETED' | 'CANCELLED';
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) data: Record<string, unknown>;
  @Column({ default: 0 }) currentStepIndex: number;
  @CreateDateColumn() startedAt: Date;
  @UpdateDateColumn() updatedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) completedAt: Date | null;
}