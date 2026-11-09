import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { FormSubmission } from './form-submission.entity';
import { User } from '../../identity/entities/user.entity';

@Entity('file_attachments')
export class FileAttachment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', insert: false, update: false }) tenantId: string;
  @Column('uuid') submissionId: string;
  @ManyToOne(() => FormSubmission, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'submissionId' }) submission: FormSubmission;
  @Column('uuid') uploadedByUserId: string;
  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'uploadedByUserId' }) uploadedBy: User;
  @Column({ length: 255 }) originalName: string;
  @Column({ length: 80, unique: true }) storageKey: string;
  @Column({ length: 100 }) mimeType: string;
  @Column('bigint') size: string;
  @Column({ length: 64 }) sha256: string;
  @CreateDateColumn() createdAt: Date;
}
