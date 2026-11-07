import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('organization_absences')
export class OrganizationAbsence {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') tenantId: string;
  @Column('uuid') organizationId: string;
  @Column('uuid') userId: string;
  @Column('uuid') substituteUserId: string;
  @Column('uuid', { unique: true }) substitutionId: string;
  @Column({ type: 'timestamptz' }) startsAt: Date;
  @Column({ type: 'timestamptz' }) endsAt: Date;
  @Column({ type: 'varchar', length: 1000 }) reason: string;
  @Column('uuid') createdByUserId: string;
  @Column({ type: 'timestamptz', nullable: true }) cancelledAt: Date | null;
  @Column('uuid', { nullable: true }) cancelledByUserId: string | null;
  @CreateDateColumn() createdAt: Date;
}
