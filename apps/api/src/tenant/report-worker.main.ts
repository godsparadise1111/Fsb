import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { startWorkerHeartbeat } from '../common/worker-heartbeat';

async function bootstrap() {
  if (process.env.FSB_REPORT_WORKER_ENABLED !== 'true') {
    throw new Error('Set FSB_REPORT_WORKER_ENABLED=true to start the report worker');
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableShutdownHooks();
  startWorkerHeartbeat(app, 'reports');
}
void bootstrap();
