import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Organization } from '../../organization/entities/organization.entity';
import { FormVersion } from './form-version.entity';

@Entity('form_definitions')
@Index(['organizationId', 'code'], { unique: true })
export class FormDefinition {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @ManyToOne(() => Organization, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organizationId' }) organization: Organization;
  @Column({ length: 120 }) code: string;
  @Column({ length: 200 }) name: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ default: 'DRAFT', length: 20 }) status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  @OneToMany(() => FormVersion, version => version.definition) versions: FormVersion[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}