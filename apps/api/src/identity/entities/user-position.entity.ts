import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { User } from './user.entity';
import { Position } from '../../organization/entities/position.entity';

@Entity('user_positions')
@Unique('UQ_user_position_active_assignment', ['userId', 'positionId', 'validFrom'])
export class UserPosition {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') userId: string;
  @ManyToOne(() => User, user => user.positions, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' }) user: User;
  @Column('uuid') positionId: string;
  @ManyToOne(() => Position, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'positionId' }) position: Position;
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' }) validFrom: Date;
  @Column({ type: 'timestamptz', nullable: true }) validUntil: Date | null;
  @Column({ default: true }) isPrimary: boolean;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
}