import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationOutbox } from './entities/notification-outbox.entity';
import { NotificationOutboxService } from './notification-outbox.service';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationOutbox])],
  providers: [NotificationOutboxService],
  exports: [NotificationOutboxService],
})
export class NotificationsModule {}
