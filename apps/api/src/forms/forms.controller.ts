import { Body, Controller, Get, Param, Post, Query, UploadedFile, UseInterceptors, StreamableFile, NotFoundException, Header } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FormsService } from './forms.service';
import { FileAttachmentsService } from './file-attachments.service';
import { CreateFormDto } from './dto/create-form.dto';
import { CreateFormVersionDto } from './dto/create-form-version.dto';
import { SubmitFormDto } from './dto/submit-form.dto';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';

type UploadedBinary = { originalname: string; mimetype: string; size: number; buffer: Buffer };

@Controller('forms')
export class FormsController {
  constructor(private readonly forms: FormsService, private readonly fileAttachments: FileAttachmentsService) {}
  @RequirePermissions('forms.manage')
  @Post() create(@Body() dto: CreateFormDto, @CurrentUser() user: AuthenticatedUser) { return this.forms.createDefinition(dto, user.tenantId); }
  @RequirePermissions('forms.read')
  @Get() list(@Query('organizationId') organizationId: string | undefined, @CurrentUser() user: AuthenticatedUser) { return this.forms.listDefinitions(organizationId, user.tenantId); }
  @RequirePermissions('forms.manage')
  @Post(':id/versions') createVersion(@Param('id') id: string, @Body() dto: CreateFormVersionDto, @CurrentUser() user: AuthenticatedUser) { return this.forms.createVersion(id, dto, user.tenantId); }
  @RequirePermissions('forms.read')
  @Get(':id/versions') versions(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) { return this.forms.listVersions(id, user.tenantId); }
  @RequirePermissions('forms.publish')
  @Post(':id/versions/:versionId/publish') publish(@Param('id') id: string, @Param('versionId') versionId: string, @CurrentUser() user: AuthenticatedUser) { return this.forms.publishVersion(id, versionId, user.tenantId); }
  @RequirePermissions('forms.submit')
  @Post('versions/:versionId/submissions') submit(@Param('versionId') versionId: string, @Body() dto: SubmitFormDto, @CurrentUser() user: AuthenticatedUser) { return this.forms.submit(versionId, user.sub, dto, user.tenantId); }
  @RequirePermissions('forms.read')
  @Get('versions/:versionId/submissions/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async exportSubmissions(
    @Param('versionId') versionId: string,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const csv = await this.forms.exportSubmissions(versionId, user.tenantId, Number(limit ?? 1000), Number(offset ?? 0));
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="form-submissions-${versionId}.csv"`,
    });
  }

  @RequirePermissions('forms.read')
  @Get('versions/:versionId/submissions') submissions(@Param('versionId') versionId: string, @Query('limit') limit: string | undefined, @Query('offset') offset: string | undefined, @CurrentUser() user: AuthenticatedUser) { return this.forms.listSubmissions(versionId, user.tenantId, Number(limit ?? 50), Number(offset ?? 0)); }

  @RequirePermissions('forms.submit')
  @Post('versions/:versionId/submissions/:submissionId/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  uploadAttachment(
    @Param('versionId') versionId: string,
    @Param('submissionId') submissionId: string,
    @UploadedFile() file: UploadedBinary,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fileAttachments.upload(versionId, submissionId, user.tenantId, user.sub, file);
  }

  @RequirePermissions('forms.read')
  @Get('versions/:versionId/submissions/:submissionId/attachments')
  listAttachments(
    @Param('versionId') versionId: string,
    @Param('submissionId') submissionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fileAttachments.list(versionId, submissionId, user.tenantId);
  }

  @RequirePermissions('forms.read')
  @Get('versions/:versionId/submissions/:submissionId/attachments/:attachmentId/download')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async downloadAttachment(
    @Param('versionId') versionId: string,
    @Param('submissionId') submissionId: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.fileAttachments.getForDownload(versionId, submissionId, attachmentId, user.tenantId);
    if (!result) throw new NotFoundException('Attachment not found');
    const filename = encodeURIComponent(result.attachment.originalName);
    return new StreamableFile(result.buffer, {
      type: result.attachment.mimeType,
      disposition: `attachment; filename="attachment"; filename*=UTF-8''${filename}`,
    });
  }
}
