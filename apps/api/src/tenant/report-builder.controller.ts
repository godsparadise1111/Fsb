import { BadRequestException, Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { RequiresFeature } from '../auth/decorators/requires-feature.decorator';
import { ReportBuilderService, ReportSpec } from './report-builder.service';

@Controller('tenant/report-builder')
@RequiresFeature('advanced_reports')
@RequirePermissions('tenant.reports.read')
export class ReportBuilderController {
  constructor(private readonly reports: ReportBuilderService) {}

  private context(user: AuthenticatedUser) {
    if (!user.tenantId) throw new BadRequestException('زمینه مشتری الزامی است');
    return { tenantId: user.tenantId, userId: user.sub };
  }

  @Get('catalog')
  catalog() { return this.reports.catalog(); }

  @Get('saved')
  list(@CurrentUser() user: AuthenticatedUser) {
    const context = this.context(user);
    return this.reports.listSaved(context.tenantId, context.userId);
  }

  @Post('run')
  run(@CurrentUser() user: AuthenticatedUser, @Body() spec: ReportSpec) {
    return this.reports.execute(this.context(user).tenantId, spec);
  }

  @Post('saved')
  save(@CurrentUser() user: AuthenticatedUser, @Body() input: { title: string; description?: string; isShared?: boolean; config: ReportSpec }) {
    const context = this.context(user);
    return this.reports.save(context.tenantId, context.userId, input);
  }

  @Get('saved/:id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const context = this.context(user);
    return this.reports.getSaved(context.tenantId, context.userId, id);
  }

  @Patch('saved/:id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: { title?: string; description?: string; isShared?: boolean; config?: ReportSpec }) {
    const context = this.context(user);
    return this.reports.update(context.tenantId, context.userId, id, input);
  }

  @Delete('saved/:id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const context = this.context(user);
    return this.reports.remove(context.tenantId, context.userId, id);
  }

  @Get('saved/:id/run')
  runSaved(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const context = this.context(user);
    return this.reports.executeSaved(context.tenantId, context.userId, id);
  }

  @Get('saved/:id/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async exportSaved(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const context = this.context(user);
    const result = await this.reports.executeSaved(context.tenantId, context.userId, id);
    return new StreamableFile(Buffer.from(this.reports.csv(result.result), 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="fsb-custom-report.csv"',
    });
  }
}
