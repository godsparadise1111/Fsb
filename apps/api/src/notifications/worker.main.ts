import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';

async function bootstrap() {
  const enabled = [
    process.env.FSB_NOTIFICATION_WORKER_ENABLED,
    process.env.FSB_WORKFLOW_AUTOMATION_ENABLED,
    process.env.FSB_WORKFLOW_RECOVERY_ENABLED,
  ].some(value => value === 'true');
  if (!enabled) {
    throw new Error(
      'Set FSB_NOTIFICATION_WORKER_ENABLED=true, FSB_WORKFLOW_AUTOMATION_ENABLED=true, or FSB_WORKFLOW_RECOVERY_ENABLED=true to start this worker process',
    );
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableShutdownHooks();
}
void bootstrap();
