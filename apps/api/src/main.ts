import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { AppModule } from './app.module';
import { TelemetryService } from './health/telemetry.service';
import {
  FixedWindowRateLimiter, callerKey, ipKey, parseTrustProxy, positiveInt, rateLimitMiddleware, securityHeadersMiddleware,
} from './common/http-security';

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

  // Express hardening: never advertise the framework, and only trust X-Forwarded-For from explicitly configured proxies.
  const http = app.getHttpAdapter().getInstance();
  http.disable('x-powered-by');
  const trustProxy = parseTrustProxy(process.env.FSB_TRUST_PROXY);
  if (trustProxy !== false) http.set('trust proxy', trustProxy);
  else if (process.env.NODE_ENV === 'production') {
    console.warn(JSON.stringify({ level: 'warn', event: 'trust_proxy_not_configured',
      message: 'FSB_TRUST_PROXY is unset: behind a reverse proxy every client appears with the proxy IP. Set it to the number of proxy hops (for example 1).' }));
  }

  app.enableCors({
    origin: process.env.NODE_ENV === 'production' ? allowedOrigins : true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Request-ID', 'X-FSB-API-Key', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-ID', 'Retry-After'],
  });
  app.enableShutdownHooks();
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, transform: true, forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: false },
  }));

  app.use(securityHeadersMiddleware({ forceHsts: process.env.FSB_HSTS === 'true' }));
  if (process.env.FSB_RATE_LIMIT_ENABLED !== 'false') {
    // Coarse flood guards. Per-account lockout of failed sign-ins is enforced separately in the database.
    const general = new FixedWindowRateLimiter({ windowMs: 60_000, max: positiveInt(process.env.FSB_RATE_LIMIT_PER_MINUTE, 600) });
    const authentication = new FixedWindowRateLimiter({ windowMs: 60_000, max: positiveInt(process.env.FSB_AUTH_RATE_LIMIT_PER_MINUTE, 120) });
    app.use(rateLimitMiddleware(authentication, ipKey, path => path.startsWith('/api/auth/')));
    app.use(rateLimitMiddleware(general, callerKey));
  }

  const telemetry = app.get(TelemetryService);
  app.use((request: any, response: any, next: () => void) => {
    const supplied = request.headers['x-request-id'];
    const requestId = typeof supplied === 'string' && /^[A-Za-z0-9._:-]{8,100}$/.test(supplied)
      ? supplied : randomUUID();
    const startedAt = process.hrtime.bigint();
    response.setHeader('X-Request-ID', requestId);
    response.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const route = request.route?.path
        ? `${request.baseUrl ?? ''}${request.route.path}`
        : '/unmatched';
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
