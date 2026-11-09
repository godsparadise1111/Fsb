import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { TenantDashboardService } from './tenant-dashboard.service';

@Controller('tenant/dashboard')
export class TenantDashboardController {
  constructor(private readonly dashboard: TenantDashboardService) {}

  @RequirePermissions('workflow.tasks.read')
  @Get('me')
  personal(@CurrentUser() user: AuthenticatedUser) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.dashboard.getPersonal(user.tenantId, user.sub);
  }

  @RequirePermissions('workflow.substitutions.manage')
  @Get('organization')
  organization(@Query('organizationId') organizationId: string, @CurrentUser() user: AuthenticatedUser) {
    if (!user.tenantId || !organizationId) throw new BadRequestException('Tenant and organization context are required');
    return this.dashboard.getOrganization(user.tenantId, organizationId, user.sub);
  }

  @RequirePermissions('tenant.usage.read')
  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.dashboard.get(user.tenantId, { sub: user.sub, isTenantAdmin: user.isTenantAdmin });
  }
}
