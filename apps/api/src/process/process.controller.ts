import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ProcessService } from './process.service';
import { CreateProcessDto } from './dto/create-process.dto';
import { CreateProcessVersionDto } from './dto/create-process-version.dto';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';

@Controller('process-definitions')
export class ProcessController {
  constructor(private readonly processes: ProcessService) {}
  @RequirePermissions('processes.manage')
  @Post() create(@Body() dto: CreateProcessDto) { return this.processes.createDefinition(dto); }
  @RequirePermissions('processes.read')
  @Get() list(@Query('organizationId') organizationId?: string) { return this.processes.listDefinitions(organizationId); }
  @RequirePermissions('processes.manage')
  @Post(':id/versions') createVersion(@Param('id') id: string, @Body() dto: CreateProcessVersionDto) { return this.processes.createVersion(id, dto); }
  @RequirePermissions('processes.read')
  @Get(':id/versions') versions(@Param('id') id: string) { return this.processes.listVersions(id); }
  @RequirePermissions('processes.publish')
  @Post(':id/versions/:versionId/publish') publish(@Param('id') id: string, @Param('versionId') versionId: string) { return this.processes.publishVersion(id, versionId); }
  @RequirePermissions('processes.manage')
  @Patch(':id/archive') archive(@Param('id') id: string) { return this.processes.archiveDefinition(id); }
}