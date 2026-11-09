import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { TelemetryService } from './telemetry.service';
@Module({ controllers: [HealthController], providers: [TelemetryService], exports: [TelemetryService] })
export class HealthModule {}
