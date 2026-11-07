import { Column, CreateDateColumn, Entity, ManyToOne, JoinColumn, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { OrganizationUnit } from './organization-unit.entity';
import { Tenant } from '../../tenant/entities/tenant.entity';
@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { nullable: true }) tenantId: string | null;
  @ManyToOne(() => Tenant, tenant => tenant.organizations, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenantId' }) tenant: Tenant | null;
  @Column({ length: 160 }) name: string;
  @Column({ length: 80, unique: true }) code: string;
  @Column({ default: true }) isActive: boolean;
  @OneToMany(() => OrganizationUnit, unit => unit.organization) units: OrganizationUnit[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
