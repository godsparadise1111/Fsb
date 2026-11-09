import { BadRequestException, Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { RequiresFeature } from '../auth/decorators/requires-feature.decorator';
import { ReportBuilderService, ReportSpec } from './report-builder.service';
import { ReportBuilderExportsService } from './report-builder-exports.service';
import { nextReportScheduleAt, ReportScheduleFrequency } from './report-schedule-time';

@Controller('tenant/report-builder')
@RequiresFeature('advanced_reports')
export class ReportBuilderController {
  constructor(
    private readonly reports: ReportBuilderService,
    private readonly exports: ReportBuilderExportsService,
  ) {}

  private context(user: AuthenticatedUser) {
    if (!user.tenantId) throw new BadRequestException('زمینه مشتری الزامی است');
    return { tenantId: user.tenantId, userId: user.sub };
  }

  @RequirePermissions('tenant.reports.read')
  @Get('scope')
  scope(@CurrentUser() user: AuthenticatedUser) {
    const context = this.context(user);
    return this.reports.reportAccessOptions(context.tenantId, context.userId);
  }

  @RequirePermissions('tenant.reports.read')
  @Get('organizations/accessible')
  accessibleOrganizations(@CurrentUser() user: AuthenticatedUser) {
    const context = this.context(user);
    return this.reports.accessibleOrganizations(context.tenantId, context.userId);
  }

  @RequirePermissions('tenant.reports.read')
  @Get('catalog')
  async catalog(@CurrentUser() user: AuthenticatedUser, @Query('organizationId') organizationId?: string) {
    const context = this.context(user);
    const scope = await this.reports.resolveScope(context.tenantId, context.userId, organizationId);
    return this.reports.catalog(context.tenantId, scope.organizationIds, organizationId, scope.tenantWide);
  }

  @RequirePermissions('tenant.reports.read')
  @Get('saved')
  async list(@CurrentUser() user: AuthenticatedUser, @Query('organizationId') organizationId?: string) {
    const context = this.context(user);
    const scope = await this.reports.resolveScope(context.tenantId, context.userId, organizationId);
    return this.reports.listSaved(context.tenantId, context.userId, organizationId, scope.tenantWide);
  }

  @RequirePermissions('tenant.reports.read')
  @Post('run')
  async run(@CurrentUser() user: AuthenticatedUser, @Body() spec: ReportSpec) {
    if (!spec || typeof spec !== 'object') throw new BadRequestException('تعریف گزارش الزامی است');
    const context = this.context(user);
    const scope = await this.reports.resolveScope(context.tenantId, context.userId, spec.organizationId);
    return this.reports.execute(context.tenantId, spec, scope);
  }

  @RequirePermissions('tenant.reports.read')
  @Post('saved')
  async save(@CurrentUser() user: AuthenticatedUser, @Body() input: { title: string; description?: string; isShared?: boolean; config: ReportSpec; organizationId?: string }) {
    if (!input || typeof input !== 'object' || !input.config) throw new BadRequestException('تعریف گزارش برای ذخیره الزامی است');
    const context = this.context(user);
    const organizationId = input.organizationId ?? input.config?.organizationId;
    const scope = await this.reports.resolveScope(context.tenantId, context.userId, organizationId);
    const config = { ...input.config, ...(organizationId ? { organizationId } : {}) };
    return this.reports.save(context.tenantId, context.userId, { ...input, config });
  }

  @RequirePermissions('tenant.reports.read')
  @Get('saved/:id')
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('organizationId') organizationId?: string) {
    const context = this.context(user);
    const scope = await this.reports.resolveScope(context.tenantId, context.userId, organizationId);
    return this.reports.getSaved(context.tenantId, context.userId, id, organizationId, scope.tenantWide);
  }

  @RequirePermissions('tenant.reports.read')
  @Patch('saved/:id')
  async update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: { title?: string; description?: string; isShared?: boolean; config?: ReportSpec; organizationId?: string }) {
    if (!input || typeof input !== 'object') throw new BadRequestException('اطلاعات ویرایش گزارش نامعتبر است');
    const context = this.context(user);
    const organizationId = input.organizationId ?? input.config?.organizationId;
    const scope = await this.reports.resolveScope(context.tenantId, context.userId, organizationId);
    const config = input.config ? { ...input.config, ...(organizationId ? { organizationId } : {}) } : undefined;
    return this.reports.update(context.tenantId, context.userId, id, { ...input, config }, organizationId, scope.tenantWide);
  }

  @RequirePermissions('tenant.reports.read')
  @Delete('saved/:id')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('organizationId') organizationId?: string) {
    const context = this.context(user);
    const scope = await this.reports.resolveScope(context.tenantId, context.userId, organizationId);
    return this.reports.remove(context.tenantId, context.userId, id, organizationId, scope.tenantWide);
  }

  @RequirePermissions('tenant.reports.read')
  @Get('saved/:id/run')
  async runSaved(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('organizationId') organizationId?: string) {
    const context = this.context(user);
    const scope = await this.reports.resolveScope(context.tenantId, context.userId, organizationId);
    return this.reports.executeSaved(context.tenantId, context.userId, id, scope);
  }

  @RequirePermissions('tenant.reports.read')
  @Get('saved/:id/export.csv')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async exportCsv(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('organizationId') organizationId?: string) {
    const context = this.context(user);
    const scope = await this.reports.resolveScope(context.tenantId, context.userId, organizationId);
    const result = await this.reports.executeSaved(context.tenantId, context.userId, id, scope);
    return new StreamableFile(Buffer.from(this.reports.csv(result.result), 'utf8'), { type: 'text/csv; charset=utf-8', disposition: 'attachment; filename="fsb-custom-report.csv"' });
  }

  @RequirePermissions('tenant.reports.read')
  @Get('saved/:id/export.xlsx')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async exportExcel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('organizationId') organizationId?: string) {
    const context = this.context(user);
    const scope = await this.reports.resolveScope(context.tenantId, context.userId, organizationId);
    const result = await this.reports.executeSaved(context.tenantId, context.userId, id, scope);
    return new StreamableFile(await this.exports.excel(result.result), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', disposition: 'attachment; filename="fsb-custom-report.xlsx"' });
  }

  @RequirePermissions('tenant.reports.read')
  @Get('saved/:id/export.pdf')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async exportPdf(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('organizationId') organizationId?: string) {
    const context = this.context(user);
    const scope = await this.reports.resolveScope(context.tenantId, context.userId, organizationId);
    const result = await this.reports.executeSaved(context.tenantId, context.userId, id, scope);
    return new StreamableFile(await this.exports.pdf(result.result), { type: 'application/pdf', disposition: 'attachment; filename="fsb-custom-report.pdf"' });
  }

  @RequirePermissions('tenant.reports.read')
  @Post('jobs')
  async enqueue(@CurrentUser() user: AuthenticatedUser, @Body() spec: ReportSpec) {
    if (!spec || typeof spec !== 'object') throw new BadRequestException('تعریف گزارش الزامی است');
    const context = this.context(user);
    const scope = await this.reports.resolveScope(context.tenantId, context.userId, spec.organizationId);
    return this.reports.createJob(context.tenantId, context.userId, spec, scope);
  }

  @RequirePermissions('tenant.reports.read')
  @Get('jobs/:id')
  async job(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('organizationId') organizationId?: string) {
    const context = this.context(user);
    const scope = await this.reports.resolveScope(context.tenantId, context.userId, organizationId);
    return this.reports.getJob(context.tenantId, context.userId, id, scope);
  }

  @RequirePermissions('tenant.reports.read')
  @Post('schedules')
  async createSchedule(@CurrentUser() user: AuthenticatedUser, @Body() input: { config: ReportSpec; organizationId?: string; frequency: ReportScheduleFrequency; weekday?: number; timeOfDay: string; timezone: string }) {
    if (!input || typeof input !== 'object' || !input.config) throw new BadRequestException('تعریف گزارش برای زمان‌بندی الزامی است');
    if (!['DAILY','WEEKLY','MONTHLY'].includes(input.frequency)) throw new BadRequestException('تناوب زمان‌بندی معتبر نیست');
    if (!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(input.timeOfDay ?? '')) throw new BadRequestException('ساعت زمان‌بندی معتبر نیست');
    if (input.frequency === 'WEEKLY' && (!Number.isInteger(input.weekday) || (input.weekday as number) < 0 || (input.weekday as number) > 6)) throw new BadRequestException('روز هفته برای زمان‌بندی هفتگی الزامی است');
    const context = this.context(user);
    const organizationId = input.organizationId ?? input.config?.organizationId;
    const scope = await this.reports.resolveScope(context.tenantId, context.userId, organizationId);
    const config = { ...input.config, ...(organizationId ? { organizationId } : {}) };
    let next: Date;
    try { next = nextReportScheduleAt(input.frequency, input.timeOfDay, input.timezone, input.weekday ?? null); }
    catch { throw new BadRequestException('ساعت یا منطقه زمانی زمان‌بندی معتبر نیست'); }
    return this.reports.createSchedule(context.tenantId, context.userId, { ...input, config }, scope, next);
  }

  @RequirePermissions('tenant.reports.read')
  @Get('schedules')
  async schedules(@CurrentUser() user: AuthenticatedUser, @Query('organizationId') organizationId?: string) {
    const context = this.context(user);
    const scope = await this.reports.resolveScope(context.tenantId, context.userId, organizationId);
    return this.reports.listSchedules(context.tenantId, context.userId, organizationId, scope.tenantWide);
  }

  @RequirePermissions('tenant.reports.read')
  @Patch('schedules/:id/active')
  async setScheduleActive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: { active: boolean; organizationId?: string }) {
    if (!input || typeof input !== 'object') throw new BadRequestException('اطلاعات زمان‌بندی نامعتبر است');
    const context = this.context(user);
    const scope = await this.reports.resolveScope(context.tenantId, context.userId, input.organizationId);
    if (typeof input.active !== 'boolean') throw new BadRequestException('وضعیت زمان‌بندی نامعتبر است');
    return this.reports.setScheduleActive(context.tenantId, context.userId, id, input.active, input.organizationId, scope.tenantWide);
  }
}
