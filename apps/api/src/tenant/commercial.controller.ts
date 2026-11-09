import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, BadRequestException } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CommercialService } from './commercial.service';
import { CreateTenantInvoiceDto, RenewTenantSubscriptionDto, TransitionInvoiceDto, UpdateTenantSubscriptionDto } from './dto/commercial.dto';

@Controller('platform/commercial')
export class PlatformCommercialController {
  constructor(private readonly commercial: CommercialService) {}

  @RequirePermissions('tenants.read')
  @Get('plans')
  plans() { return this.commercial.listPlans(); }

  @RequirePermissions('tenants.read')
  @Get('subscriptions')
  subscriptions() { return this.commercial.listSubscriptions(); }

  @RequirePermissions('tenants.read')
  @Get('invoices')
  invoices() { return this.commercial.listInvoices(); }

  @RequirePermissions('tenants.manage')
  @Patch('tenants/:tenantId/subscription')
  updateSubscription(
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpdateTenantSubscriptionDto,
  ) {
    return this.commercial.updateSubscription({ ...dto, tenantId, actorUserId: actor.sub });
  }

  @RequirePermissions('tenants.manage')
  @Post('tenants/:tenantId/invoices')
  createInvoice(
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateTenantInvoiceDto,
  ) {
    return this.commercial.createInvoice({ ...dto, tenantId, actorUserId: actor.sub });
  }

  @RequirePermissions('tenants.manage')
  @Patch('invoices/:invoiceId/status')
  transitionInvoice(
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: TransitionInvoiceDto,
  ) {
    return this.commercial.transitionInvoice(invoiceId, dto.status, actor.sub);
  }
}

@Controller('tenant/commercial')
export class TenantCommercialController {
  constructor(private readonly commercial: CommercialService) {}

  @RequirePermissions('tenant.members.read')
  @Get()
  overview(@CurrentUser() user: AuthenticatedUser) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.commercial.getTenantOverview(user.tenantId);
  }

  @RequirePermissions('tenant.members.manage')
  @Post('renew')
  renew(@CurrentUser() user: AuthenticatedUser, @Body() dto: RenewTenantSubscriptionDto) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.commercial.renewSubscriptionFromPaidInvoice(user.tenantId, dto.invoiceId, user.sub);
  }
}
