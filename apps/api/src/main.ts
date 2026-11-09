import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { AppModule } from './app.module';
import { TelemetryService } from './health/telemetry.service';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production' && process.env.DB_SYNCHRONIZE === 'true') {
    throw new Error('DB_SYNCHRONIZE=true is forbidden in production; apply checksum-verified SQL migrations instead.');
  }
  const allowedOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (process.env.NODE_ENV === 'production' && (!allowedOrigins.length || allowedOrigins.includes('*'))) {
    throw new Error('Configure CORS_ORIGINS with explicit trusted origins before production startup.');
  }

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.NODE_ENV === 'production' ? allowedOrigins : true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Request-ID', 'X-FSB-API-Key'],
    exposedHeaders: ['X-Request-ID'],
  });
  app.enableShutdownHooks();
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, transform: true, forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: false },
  }));

  const telemetry = app.get(TelemetryService);
  app.use((request: any, response: any, next: () => void) => {
    const supplied = request.headers['x-request-id'];
    const requestId = typeof supplied === 'string' && /^[A-Za-z0-9._:-]{8,100}$/.test(supplied)
      ? supplied : randomUUID();
    const startedAt = process.hrtime.bigint();
    response.setHeader('X-Request-ID', requestId);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const route = request.route?.path
        ? `${request.baseUrl ?? ''}${request.route.path}`
        : String(request.path ?? '/unknown').replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id').replace(/\/\d+(?=\/|$)/g, '/:id');
      telemetry.record(String(request.method ?? 'OTHER'), route, response.statusCode, durationMs);
      // Never log request bodies, authorization headers, cookies, query strings or personal data.
      console.log(JSON.stringify({
        level: response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warn' : 'info',
        event: 'http_request_completed', requestId, method: request.method,
        route, statusCode: response.statusCode, durationMs: Number(durationMs.toFixed(2)),
        timestamp: new Date().toISOString(),
      }));
    });
    next();
  });

  await app.listen(Number(process.env.API_PORT ?? 3001), '0.0.0.0');
}
void bootstrap();
