import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { ProcessDefinition } from './process-definition.entity';

@Entity('process_versions')
@Unique('UQ_process_version_number', ['definitionId', 'versionNumber'])
export class ProcessVersion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') definitionId: string;
  @ManyToOne(() => ProcessDefinition, definition => definition.versions, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'definitionId' }) definition: ProcessDefinition;
  @Column() versionNumber: number;
  @Column({ default: 'DRAFT', length: 20 }) status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) schema: Record<string, unknown>;
  @Column({ type: 'text', nullable: true }) changeNote: string | null;
  @Column({ type: 'timestamptz', nullable: true }) publishedAt: Date | null;
  @CreateDateColumn() createdAt: Date;
}