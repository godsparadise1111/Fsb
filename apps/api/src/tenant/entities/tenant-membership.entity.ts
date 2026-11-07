import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Tenant } from './tenant.entity';
import { User } from '../../identity/entities/user.entity';

@Entity('tenant_memberships')
@Index('UQ_tenant_membership_user_tenant', ['tenantId', 'userId'], { unique: true })
export class TenantMembership {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') tenantId: string;
  @ManyToOne(() => Tenant, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenantId' }) tenant: Tenant;
  @Column('uuid') userId: string;
  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' }) user: User;
  @Column({ default: true }) isActive: boolean;
  @Column({ default: false }) isTenantAdmin: boolean;
  @Column({ type: 'timestamptz', nullable: true }) acceptedAt: Date | null;
  @CreateDateColumn() createdAt: Date;
}
