import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Organization } from '../../organization/entities/organization.entity';

export type TenantStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export type TenantPlan = 'CORE' | 'PROFESSIONAL' | 'ENTERPRISE';

@Entity('tenants')
@Index('UQ_tenants_slug', ['slug'], { unique: true })
@Index('UQ_tenants_code', ['code'], { unique: true })
export class Tenant {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ length: 160 }) name: string;
  @Column({ length: 80 }) slug: string;
  @Column({ length: 40 }) code: string;
  @Column({ type: 'varchar', length: 20, default: 'PENDING' }) status: TenantStatus;
  @Column({ type: 'varchar', length: 24, default: 'CORE' }) plan: TenantPlan;
  @Column({ type: 'timestamptz', nullable: true }) trialEndsAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) activatedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) suspendedAt: Date | null;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) settings: Record<string, unknown>;
  @OneToMany(() => Organization, organization => organization.tenant) organizations: Organization[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
