import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationOutbox } from './entities/notification-outbox.entity';
import { NotificationOutboxService } from './notification-outbox.service';
import { NotificationWorker } from './notification-worker.service';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationOutbox])],
  providers: [NotificationOutboxService, NotificationWorker],
  exports: [NotificationOutboxService],
})
export class NotificationsModule {}
