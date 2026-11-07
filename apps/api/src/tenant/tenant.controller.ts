import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { TenantService } from './tenant.service';

@Controller('platform/tenants')
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  @RequirePermissions('tenants.manage')
  @Post()
  create(@Body() dto: CreateTenantDto) { return this.tenants.create(dto); }

  @RequirePermissions('tenants.read')
  @Get()
  list() { return this.tenants.list(); }

  @RequirePermissions('tenants.read')
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) { return this.tenants.get(id); }

  @RequirePermissions('tenants.manage')
  @Patch(':id/status')
  changeStatus(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateTenantStatusDto) {
    return this.tenants.changeStatus(id, dto.status);
  }
}
