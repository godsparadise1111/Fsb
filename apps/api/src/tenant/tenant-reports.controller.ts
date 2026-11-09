import { BadRequestException, Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { TenantReportsService } from './tenant-reports.service';

@Controller('tenant/reports')
export class TenantReportsController {
  constructor(private readonly reports: TenantReportsService) {}

  @RequirePermissions('tenant.reports.read')
  @Get('overview.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async exportOverview(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    const csv = await this.reports.overviewCsv(user.tenantId, { from, to, organizationId });
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="fsb-management-report.csv"',
    });
  }

  @RequirePermissions('tenant.reports.read')
  @Get('operational-alert-sla.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async exportOperationalAlertSla(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    const csv = await this.reports.operationalAlertSlaCsv(user.tenantId, { from, to, organizationId });
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="fsb-operational-alert-sla.csv"',
    });
  }

  @RequirePermissions('tenant.reports.read')
  @Get('process-bottlenecks')
  processBottlenecks(@CurrentUser() user: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string, @Query('organizationId') organizationId?: string) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.reports.processBottlenecks(user.tenantId, { from, to, organizationId });
  }

  @RequirePermissions('tenant.reports.read')
  @Get('operational-alert-sla')
  operationalAlertSla(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.reports.operationalAlertSla(user.tenantId, { from, to, organizationId });
  }

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
