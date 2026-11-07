import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('organization_substitutions')
@Index('IDX_org_substitutions_substitute_active', ['tenantId', 'substituteUserId', 'startsAt', 'endsAt'])
@Index('IDX_org_substitutions_original_active', ['tenantId', 'originalUserId', 'startsAt', 'endsAt'])
export class OrganizationSubstitution {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') tenantId: string;
  @Column('uuid') organizationId: string;
  @Column('uuid') originalUserId: string;
  @Column('uuid') substituteUserId: string;
  @Column({ type: 'timestamptz' }) startsAt: Date;
  @Column({ type: 'timestamptz' }) endsAt: Date;
  @Column({ type: 'varchar', length: 1000 }) reason: string;
  @Column('uuid') createdByUserId: string;
  @Column({ type: 'timestamptz', nullable: true }) revokedAt: Date | null;
  @Column('uuid', { nullable: true }) revokedByUserId: string | null;
  @CreateDateColumn() createdAt: Date;
}
