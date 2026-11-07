import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { FormsService } from './forms.service';
import { CreateFormDto } from './dto/create-form.dto';
import { CreateFormVersionDto } from './dto/create-form-version.dto';
import { SubmitFormDto } from './dto/submit-form.dto';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';

@Controller('forms')
export class FormsController {
  constructor(private readonly forms: FormsService) {}
  @RequirePermissions('forms.manage')
  @Post() create(@Body() dto: CreateFormDto) { return this.forms.createDefinition(dto); }
  @RequirePermissions('forms.read')
  @Get() list(@Query('organizationId') organizationId?: string) { return this.forms.listDefinitions(organizationId); }
  @RequirePermissions('forms.manage')
  @Post(':id/versions') createVersion(@Param('id') id: string, @Body() dto: CreateFormVersionDto) { return this.forms.createVersion(id, dto); }
  @RequirePermissions('forms.read')
  @Get(':id/versions') versions(@Param('id') id: string) { return this.forms.listVersions(id); }
  @RequirePermissions('forms.publish')
  @Post(':id/versions/:versionId/publish') publish(@Param('id') id: string, @Param('versionId') versionId: string) { return this.forms.publishVersion(id, versionId); }
  @RequirePermissions('forms.submit')
  @Post('versions/:versionId/submissions') submit(@Param('versionId') versionId: string, @Body() dto: SubmitFormDto, @CurrentUser() user: AuthenticatedUser) { return this.forms.submit(versionId, user.sub, dto); }
  @RequirePermissions('forms.read')
  @Get('versions/:versionId/submissions') submissions(@Param('versionId') versionId: string) { return this.forms.listSubmissions(versionId); }
}