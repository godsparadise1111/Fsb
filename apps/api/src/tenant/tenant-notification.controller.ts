import { BadRequestException, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { RequiresFeature } from '../auth/decorators/requires-feature.decorator';
import { TenantNotificationService } from './tenant-notification.service';

@Controller('tenant/notifications')
@RequiresFeature('email_notifications')
export class TenantNotificationController {
  constructor(private readonly notifications: TenantNotificationService) {}

  @RequirePermissions('tenant.notifications.read')
  @Get('queue')
  overview(@CurrentUser() user: AuthenticatedUser) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.notifications.queueOverview(user.tenantId);
  }

  @RequirePermissions('tenant.notifications.read')
  @Get('queue/items')
  items(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string, @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.notifications.listQueue(user.tenantId, status, limit);
  }

  @RequirePermissions('tenant.notifications.read')
  @Get('dead')
  list(@CurrentUser() user: AuthenticatedUser, @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.notifications.listDead(user.tenantId, limit);
  }

  @RequirePermissions('tenant.notifications.manage')
  @Post(':id/retry')
  retry(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthenticatedUser) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.notifications.retryDead(user.tenantId, id, user.sub);
  }

  @RequirePermissions('tenant.notifications.manage')
  @Post('dead/:id/retry')
  retryDead(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.notifications.retryDead(user.tenantId, id, user.sub);
  }
}
