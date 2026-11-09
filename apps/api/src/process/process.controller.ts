import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ProcessService } from './process.service';
import { CreateProcessDto } from './dto/create-process.dto';
import { CreateProcessVersionDto } from './dto/create-process-version.dto';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@Controller('process-definitions')
export class ProcessController {
  constructor(private readonly processes: ProcessService) {}
  @RequirePermissions('processes.manage')
  @Post() create(@Body() dto: CreateProcessDto, @CurrentUser() user: AuthenticatedUser) { return this.processes.createDefinition(dto, user.tenantId); }
  @RequirePermissions('processes.read')
  @Get() list(@Query('organizationId') organizationId: string | undefined, @CurrentUser() user: AuthenticatedUser) { return this.processes.listDefinitions(organizationId, user.tenantId); }
  @RequirePermissions('processes.manage')
  @Post(':id/versions') createVersion(@Param('id') id: string, @Body() dto: CreateProcessVersionDto, @CurrentUser() user: AuthenticatedUser) { return this.processes.createVersion(id, dto, user.tenantId); }
  @RequirePermissions('processes.read')
  @Get(':id/versions') versions(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) { return this.processes.listVersions(id, user.tenantId); }
  @RequirePermissions('processes.publish')
  @Post(':id/versions/:versionId/publish') publish(@Param('id') id: string, @Param('versionId') versionId: string, @CurrentUser() user: AuthenticatedUser) { return this.processes.publishVersion(id, versionId, user.tenantId); }
  @RequirePermissions('processes.manage')
  @Patch(':id/archive') archive(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) { return this.processes.archiveDefinition(id, user.tenantId); }
}