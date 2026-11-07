import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { CreateUnitDto } from './dto/create-unit.dto';
import { OrganizationService } from './organization.service';
@Controller('organizations')
export class OrganizationController {
  constructor(private readonly service: OrganizationService) {}
  @Post() create(@Body() dto: CreateOrganizationDto) { return this.service.createOrganization(dto); }
  @Get() list() { return this.service.listOrganizations(); }
  @Post('units') createUnit(@Body() dto: CreateUnitDto) { return this.service.createUnit(dto); }
  @Get(':organizationId/units') units(@Param('organizationId', new ParseUUIDPipe()) id: string) { return this.service.listUnits(id); }
}
