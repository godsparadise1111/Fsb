import { BadRequestException, Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { TenantAuditService } from './tenant-audit.service';

@Controller('tenant/audit-logs')
export class TenantAuditController {
  constructor(private readonly audit: TenantAuditService) {}

  @RequirePermissions('tenant.audit.read')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.audit.list(user.tenantId, limit);
  }
}
