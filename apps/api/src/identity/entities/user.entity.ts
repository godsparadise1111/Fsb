import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { UserPosition } from './user-position.entity';
import { UserRole } from './user-role.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ length: 120 }) firstName: string;
  @Column({ length: 120 }) lastName: string;
  @Column({ unique: true, length: 190 }) email: string;
  @Column({ unique: true, length: 80 }) username: string;
  @Column({ select: false, nullable: true, length: 255 }) passwordHash: string | null;
  @Column({ default: true }) isActive: boolean;
  @Column({ nullable: true, length: 40 }) phone: string | null;
  @OneToMany(() => UserPosition, membership => membership.user) positions: UserPosition[];
  @OneToMany(() => UserRole, assignment => assignment.user) roles: UserRole[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}