import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ProcessService } from './process.service';
import { CreateProcessDto } from './dto/create-process.dto';
import { CreateProcessVersionDto } from './dto/create-process-version.dto';

@Controller('process-definitions')
export class ProcessController {
  constructor(private readonly processes: ProcessService) {}
  @Post() create(@Body() dto: CreateProcessDto) { return this.processes.createDefinition(dto); }
  @Get() list(@Query('organizationId') organizationId?: string) { return this.processes.listDefinitions(organizationId); }
  @Post(':id/versions') createVersion(@Param('id') id: string, @Body() dto: CreateProcessVersionDto) { return this.processes.createVersion(id, dto); }
  @Get(':id/versions') versions(@Param('id') id: string) { return this.processes.listVersions(id); }
  @Post(':id/versions/:versionId/publish') publish(@Param('id') id: string, @Param('versionId') versionId: string) { return this.processes.publishVersion(id, versionId); }
  @Patch(':id/archive') archive(@Param('id') id: string) { return this.processes.archiveDefinition(id); }
}