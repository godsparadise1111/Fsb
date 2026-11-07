import { Column, CreateDateColumn, Entity, Index, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn, JoinColumn } from 'typeorm';
import { Organization } from '../../organization/entities/organization.entity';
import { ProcessVersion } from './process-version.entity';

@Entity('process_definitions')
@Index(['organizationId', 'code'], { unique: true })
export class ProcessDefinition {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @ManyToOne(() => Organization, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organizationId' }) organization: Organization;
  @Column({ length: 120 }) code: string;
  @Column({ length: 200 }) name: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ default: 'DRAFT', length: 20 }) status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  @OneToMany(() => ProcessVersion, version => version.definition) versions: ProcessVersion[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}