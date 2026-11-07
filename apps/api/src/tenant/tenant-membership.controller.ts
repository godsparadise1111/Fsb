import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CreateTenantMembershipDto } from './dto/create-tenant-membership.dto';
import { TenantMembershipService } from './tenant-membership.service';
import { IsBoolean } from 'class-validator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

class UpdateTenantAdminDto { @IsBoolean() isTenantAdmin: boolean; }

@Controller('platform/tenants/:tenantId/members')
export class TenantMembershipController {
  constructor(private readonly memberships: TenantMembershipService) {}

  @RequirePermissions('tenants.manage')
  @Post()
  add(@Param('tenantId', new ParseUUIDPipe()) tenantId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTenantMembershipDto) {
    return this.memberships.add(tenantId, dto.userId, user.sub, dto.isTenantAdmin ?? false);
  }

  @RequirePermissions('tenants.read')
  @Get()
  list(@Param('tenantId', new ParseUUIDPipe()) tenantId: string) { return this.memberships.list(tenantId); }

  @RequirePermissions('tenants.manage')
  @Patch(':userId/admin')
  setAdmin(@Param('tenantId', new ParseUUIDPipe()) tenantId: string, @Param('userId', new ParseUUIDPipe()) userId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateTenantAdminDto) {
    return this.memberships.setAdmin(tenantId, userId, user.sub, dto.isTenantAdmin);
  }

  @RequirePermissions('tenants.manage')
  @Delete(':userId')
  remove(@Param('tenantId', new ParseUUIDPipe()) tenantId: string, @Param('userId', new ParseUUIDPipe()) userId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.memberships.remove(tenantId, userId, user.sub);
  }
}
