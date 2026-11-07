import { BadRequestException, Controller, Get } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { TenantUsageService } from './tenant-usage.service';

@Controller('tenant/usage')
export class TenantUsageController {
  constructor(private readonly usage: TenantUsageService) {}

  @RequirePermissions('tenant.usage.read')
  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.usage.get(user.tenantId);
  }
}
