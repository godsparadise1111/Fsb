import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { startWorkerHeartbeat } from '../common/worker-heartbeat';

async function bootstrap() {
  const flags = {
    notifications: process.env.FSB_NOTIFICATION_WORKER_ENABLED === 'true',
    'workflow-automation': process.env.FSB_WORKFLOW_AUTOMATION_ENABLED === 'true',
    'workflow-recovery': process.env.FSB_WORKFLOW_RECOVERY_ENABLED === 'true',
  };
  const active = Object.entries(flags).filter(([, enabled]) => enabled).map(([name]) => name);
  if (active.length === 0) {
    throw new Error(
      'Set FSB_NOTIFICATION_WORKER_ENABLED=true, FSB_WORKFLOW_AUTOMATION_ENABLED=true, or FSB_WORKFLOW_RECOVERY_ENABLED=true to start this worker process',
    );
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableShutdownHooks();
  startWorkerHeartbeat(app, active.join('+'));
}
void bootstrap();
