import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { FormsService } from './forms.service';
import { CreateFormDto } from './dto/create-form.dto';
import { CreateFormVersionDto } from './dto/create-form-version.dto';
import { SubmitFormDto } from './dto/submit-form.dto';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@Controller('forms')
export class FormsController {
  constructor(private readonly forms: FormsService) {}
  @Post() create(@Body() dto: CreateFormDto) { return this.forms.createDefinition(dto); }
  @Get() list(@Query('organizationId') organizationId?: string) { return this.forms.listDefinitions(organizationId); }
  @Post(':id/versions') createVersion(@Param('id') id: string, @Body() dto: CreateFormVersionDto) { return this.forms.createVersion(id, dto); }
  @Get(':id/versions') versions(@Param('id') id: string) { return this.forms.listVersions(id); }
  @Post(':id/versions/:versionId/publish') publish(@Param('id') id: string, @Param('versionId') versionId: string) { return this.forms.publishVersion(id, versionId); }
  @Post('versions/:versionId/submissions') submit(@Param('versionId') versionId: string, @Body() dto: SubmitFormDto, @CurrentUser() user: AuthenticatedUser) { return this.forms.submit(versionId, user.sub, dto); }
  @Get('versions/:versionId/submissions') submissions(@Param('versionId') versionId: string) { return this.forms.listSubmissions(versionId); }
}