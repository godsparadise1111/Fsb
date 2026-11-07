import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('tenant_audit_logs')
@Index('IDX_tenant_audit_tenant_created', ['tenantId', 'createdAt'])
@Index('IDX_tenant_audit_actor', ['tenantId', 'actorUserId', 'createdAt'])
export class TenantAuditLog {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') tenantId: string;
  @Column('uuid') actorUserId: string;
  @Column('uuid', { nullable: true }) targetUserId: string | null;
  @Column({ length: 80 }) action: string;
  @Column({ length: 80 }) resourceType: string;
  @Column('uuid', { nullable: true }) resourceId: string | null;
  @Column({ type: 'jsonb', nullable: true }) metadata: Record<string, unknown> | null;
  @CreateDateColumn() createdAt: Date;
}
