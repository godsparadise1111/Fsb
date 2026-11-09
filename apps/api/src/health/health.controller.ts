import { Controller, Get, Headers, Header, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { DataSource } from 'typeorm';
import { Public } from '../auth/decorators/public.decorator';
import { TelemetryService } from './telemetry.service';

@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource, private readonly telemetry: TelemetryService) {}

  @Public()
  @Get()
  check() {
    return { status: 'ok', service: 'fsb-api', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  async readiness() {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ready', service: 'fsb-api', database: 'reachable', timestamp: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready', service: 'fsb-api', database: 'unavailable',
        timestamp: new Date().toISOString(),
      });
    }
  }

  @Public()
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  metrics(@Headers('authorization') authorization?: string) {
    const expected = process.env.FSB_METRICS_TOKEN ?? '';
    if (expected.length < 32) throw new NotFoundException();
    const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const a = Buffer.from(expected);
    const b = Buffer.from(supplied);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new NotFoundException();
    return this.telemetry.renderPrometheus();
  }
}
