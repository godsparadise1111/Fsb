import { BadRequestException, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { TenantNotificationService } from './tenant-notification.service';

@Controller('tenant/notifications/dead')
export class TenantNotificationController {
  constructor(private readonly notifications: TenantNotificationService) {}

  @RequirePermissions('tenant.notifications.read')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.notifications.listDead(user.tenantId, limit);
  }

  @RequirePermissions('tenant.notifications.manage')
  @Post(':id/retry')
  retry(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.notifications.retryDead(user.tenantId, id, user.sub);
  }
}
