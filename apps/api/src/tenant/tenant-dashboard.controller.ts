import { BadRequestException, Controller, Get } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { TenantDashboardService } from './tenant-dashboard.service';

@Controller('tenant/dashboard')
export class TenantDashboardController {
  constructor(private readonly dashboard: TenantDashboardService) {}

  @RequirePermissions('tenant.usage.read')
  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.dashboard.get(user.tenantId, { sub: user.sub, isTenantAdmin: user.isTenantAdmin });
  }
}
