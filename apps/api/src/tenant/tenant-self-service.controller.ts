import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CreateTenantMembershipDto } from './dto/create-tenant-membership.dto';
import { TenantMembershipService } from './tenant-membership.service';

class UpdateTenantAdminDto { @IsBoolean() isTenantAdmin: boolean; }

@Controller('tenant/members')
export class TenantSelfServiceController {
  constructor(private readonly memberships: TenantMembershipService) {}

  @RequirePermissions('tenant.members.read')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.memberships.list(user.tenantId);
  }

  @RequirePermissions('tenant.members.manage')
  @Post()
  add(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTenantMembershipDto) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.memberships.add(user.tenantId, dto.userId, user.sub, dto.isTenantAdmin ?? false);
  }

  @RequirePermissions('tenant.members.manage')
  @Patch(':userId/admin')
  setAdmin(@CurrentUser() user: AuthenticatedUser, @Param('userId', new ParseUUIDPipe()) userId: string, @Body() dto: UpdateTenantAdminDto) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.memberships.setAdmin(user.tenantId, userId, user.sub, dto.isTenantAdmin);
  }

  @RequirePermissions('tenant.members.manage')
  @Delete(':userId')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('userId', new ParseUUIDPipe()) userId: string) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.memberships.remove(user.tenantId, userId, user.sub);
  }
}
