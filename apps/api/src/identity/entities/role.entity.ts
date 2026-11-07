import { Column, CreateDateColumn, Entity, JoinTable, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Permission } from './permission.entity';

@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true, length: 80 }) code: string;
  @Column({ length: 160 }) name: string;
  @Column({ nullable: true, length: 500 }) description: string | null;
  // PLATFORM roles are reserved for platform operators; ordinary roles never gain global reach.\n  @Column({ length: 24, default: 'ORGANIZATION' }) scope: 'PLATFORM' | 'ORGANIZATION';\n  @Column({ default: true }) isActive: boolean;
  @ManyToMany(() => Permission, permission => permission.roles)
  @JoinTable({ name: 'role_permissions', joinColumn: { name: 'roleId', referencedColumnName: 'id' }, inverseJoinColumn: { name: 'permissionId', referencedColumnName: 'id' } })
  permissions: Permission[];
  @CreateDateColumn() createdAt: Date;
}