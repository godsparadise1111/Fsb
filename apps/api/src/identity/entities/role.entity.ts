import { Column, CreateDateColumn, Entity, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Permission } from './permission.entity';

@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true, length: 80 }) code: string;
  @Column({ length: 160 }) name: string;
  @Column({ nullable: true, length: 500 }) description: string | null;
  @Column({ default: true }) isActive: boolean;
  @ManyToMany(() => Permission, permission => permission.roles) permissions: Permission[];
  @CreateDateColumn() createdAt: Date;
}