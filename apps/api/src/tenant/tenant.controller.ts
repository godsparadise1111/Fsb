import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { TenantService } from './tenant.service';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@Controller('platform/tenants')
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  @RequirePermissions('tenants.manage')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTenantDto) { return this.tenants.create(dto, user.sub); }

  @RequirePermissions('tenants.read')
  @Get()
  list() { return this.tenants.list(); }

  @RequirePermissions('tenants.read')
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) { return this.tenants.get(id); }

  @RequirePermissions('tenants.manage')
  @Patch(':id/status')
  changeStatus(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateTenantStatusDto) {
    return this.tenants.changeStatus(id, dto.status, user.sub);
  }
}
