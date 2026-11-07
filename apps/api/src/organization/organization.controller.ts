import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { CreateUnitDto } from './dto/create-unit.dto';
import { CreatePositionDto } from './dto/create-position.dto';
import { OrganizationService } from './organization.service';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
@Controller('organizations')
export class OrganizationController {
  constructor(private readonly service: OrganizationService) {}
  @RequirePermissions('organization.manage')
  @Post() create(@Body() dto: CreateOrganizationDto) { return this.service.createOrganization(dto); }
  @RequirePermissions('organization.read')
  @Get() list() { return this.service.listOrganizations(); }
  @RequirePermissions('organization.manage')
  @Post('units') createUnit(@Body() dto: CreateUnitDto) { return this.service.createUnit(dto); }
  @RequirePermissions('organization.read')
  @Get(':organizationId/units') units(@Param('organizationId', new ParseUUIDPipe()) id: string) { return this.service.listUnits(id); }
  @RequirePermissions('organization.manage')
  @Post('positions') createPosition(@Body() dto: CreatePositionDto) { return this.service.createPosition(dto); }
  @RequirePermissions('organization.read')
  @Get('units/:unitId/positions') positions(@Param('unitId', new ParseUUIDPipe()) id: string) { return this.service.listPositions(id); }
}
