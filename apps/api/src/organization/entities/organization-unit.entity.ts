import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn, Index } from 'typeorm';
import { Organization } from './organization.entity';
import { Position } from './position.entity';
@Entity('organization_units')
@Index(['organizationId', 'parentId', 'code'], { unique: true })
export class OrganizationUnit {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @ManyToOne(() => Organization, organization => organization.units, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' }) organization: Organization;
  @Column({ length: 160 }) name: string;
  @Column({ length: 80 }) code: string;
  @Column('uuid', { nullable: true }) parentId: string | null;
  @ManyToOne(() => OrganizationUnit, unit => unit.children, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'parentId' }) parent: OrganizationUnit | null;
  @OneToMany(() => OrganizationUnit, unit => unit.parent) children: OrganizationUnit[];
  @OneToMany(() => Position, position => position.unit) positions: Position[];
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
