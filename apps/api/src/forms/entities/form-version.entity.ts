import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { FormDefinition } from './form-definition.entity';

@Entity('form_versions')
@Unique('UQ_form_version_number', ['definitionId', 'versionNumber'])
export class FormVersion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { insert: false, update: false }) tenantId: string;
  @Column('uuid') definitionId: string;
  @ManyToOne(() => FormDefinition, definition => definition.versions, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'definitionId' }) definition: FormDefinition;
  @Column() versionNumber: number;
  @Column({ default: 'DRAFT', length: 20 }) status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  @Column({ type: 'jsonb' }) schema: Record<string, unknown>;
  @Column({ type: 'text', nullable: true }) changeNote: string | null;
  @Column({ type: 'timestamptz', nullable: true }) publishedAt: Date | null;
  @CreateDateColumn() createdAt: Date;
}