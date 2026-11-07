import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { User } from './user.entity';
import { Role } from './role.entity';
import { Organization } from '../../organization/entities/organization.entity';

@Entity('user_roles')
@Unique('UQ_user_role_scope', ['userId', 'roleId', 'organizationId'])
export class UserRole {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { nullable: true, insert: false, update: false }) tenantId: string | null;
  @Column('uuid') userId: string;
  @ManyToOne(() => User, user => user.roles, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' }) user: User;
  @Column('uuid') roleId: string;
  @ManyToOne(() => Role, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'roleId' }) role: Role;
  @Column('uuid', { nullable: true }) organizationId: string | null;
  @ManyToOne(() => Organization, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organizationId' }) organization: Organization | null;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
}