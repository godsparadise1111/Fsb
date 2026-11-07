import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { OrganizationUnit } from './organization-unit.entity';
@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ length: 160 }) name: string;
  @Column({ length: 80, unique: true }) code: string;
  @Column({ default: true }) isActive: boolean;
  @OneToMany(() => OrganizationUnit, unit => unit.organization) units: OrganizationUnit[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
