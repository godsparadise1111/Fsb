import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { TenantReportsService } from './tenant-reports.service';

@Controller('tenant/reports')
export class TenantReportsController {
  constructor(private readonly reports: TenantReportsService) {}

  @RequirePermissions('tenant.reports.read')
  @Get('overview')
  overview(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.reports.overview(user.tenantId, { from, to, organizationId });
  }
}
