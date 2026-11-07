import { Column, CreateDateColumn, Entity, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Role } from './role.entity';

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true, length: 120 }) code: string;
  @Column({ length: 160 }) name: string;
  @Column({ nullable: true, length: 500 }) description: string | null;
  @ManyToMany(() => Role, role => role.permissions) roles: Role[];
  @CreateDateColumn() createdAt: Date;
}