import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';

async function bootstrap() {
  if (process.env.FSB_NOTIFICATION_WORKER_ENABLED !== 'true') {
    throw new Error('Set FSB_NOTIFICATION_WORKER_ENABLED=true to start the notification worker');
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableShutdownHooks();
}
void bootstrap();
