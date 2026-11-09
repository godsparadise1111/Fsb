import { Controller, Get } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { PlatformWorkflowHealthService } from './platform-workflow-health.service';

@Controller('platform/workflow-health')
export class PlatformWorkflowHealthController {
  constructor(private readonly health: PlatformWorkflowHealthService) {}

  @RequirePermissions('tenants.read')
  @Get()
  get() {
    return this.health.get();
  }
}
