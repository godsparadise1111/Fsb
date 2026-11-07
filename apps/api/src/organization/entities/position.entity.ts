import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { OrganizationUnit } from './organization-unit.entity';
@Entity('positions')
export class Position {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationUnitId: string;
  @ManyToOne(() => OrganizationUnit, unit => unit.positions, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organizationUnitId' }) unit: OrganizationUnit;
  @Column({ length: 160 }) title: string;
  @Column({ length: 80 }) code: string;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
