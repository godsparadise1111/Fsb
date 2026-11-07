import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Tenant } from './tenant.entity';
import { User } from '../../identity/entities/user.entity';

@Entity('tenant_invitations')
@Index('UQ_tenant_invitations_token_hash', ['tokenHash'], { unique: true })
@Index('IDX_tenant_invitations_tenant_email', ['tenantId', 'email'])
export class TenantInvitation {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') tenantId: string;
  @ManyToOne(() => Tenant, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenantId' }) tenant: Tenant;
  @Column({ length: 190 }) email: string;
  @Column({ length: 64, select: false }) tokenHash: string;
  @Column('uuid') invitedByUserId: string;
  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'invitedByUserId' }) invitedBy: User;
  @Column({ default: false }) isTenantAdmin: boolean;
  @Column({ type: 'timestamptz' }) expiresAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) acceptedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) revokedAt: Date | null;
  @Column('uuid', { nullable: true }) acceptedByUserId: string | null;
  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'acceptedByUserId' }) acceptedBy: User | null;
  @CreateDateColumn() createdAt: Date;
}
