import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CreateTenantMembershipDto } from './dto/create-tenant-membership.dto';
import { TenantMembershipService } from './tenant-membership.service';
import { IsBoolean } from 'class-validator';

class UpdateTenantAdminDto { @IsBoolean() isTenantAdmin: boolean; }

@Controller('platform/tenants/:tenantId/members')
export class TenantMembershipController {
  constructor(private readonly memberships: TenantMembershipService) {}

  @RequirePermissions('tenants.manage')
  @Post()
  add(@Param('tenantId', new ParseUUIDPipe()) tenantId: string, @Body() dto: CreateTenantMembershipDto) {
    return this.memberships.add(tenantId, dto.userId, dto.isTenantAdmin ?? false);
  }

  @RequirePermissions('tenants.read')
  @Get()
  list(@Param('tenantId', new ParseUUIDPipe()) tenantId: string) { return this.memberships.list(tenantId); }

  @RequirePermissions('tenants.manage')
  @Patch(':userId/admin')
  setAdmin(@Param('tenantId', new ParseUUIDPipe()) tenantId: string, @Param('userId', new ParseUUIDPipe()) userId: string, @Body() dto: UpdateTenantAdminDto) {
    return this.memberships.setAdmin(tenantId, userId, dto.isTenantAdmin);
  }

  @RequirePermissions('tenants.manage')
  @Delete(':userId')
  remove(@Param('tenantId', new ParseUUIDPipe()) tenantId: string, @Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.memberships.remove(tenantId, userId);
  }
}
