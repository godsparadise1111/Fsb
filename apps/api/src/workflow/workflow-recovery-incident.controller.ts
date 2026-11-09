import { BadRequestException, Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { WorkflowRecoveryIncidentService } from './workflow-recovery-incident.service';

@Controller('workflow/recovery-incidents')
export class WorkflowRecoveryIncidentController {
  constructor(private readonly incidents: WorkflowRecoveryIncidentService) {}

  private tenant(user: AuthenticatedUser) {
    if (!user.tenantId) throw new BadRequestException('Active tenant context is required');
    return user.tenantId;
  }

  @RequirePermissions('workflow.recovery.incidents.read')
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('organizationId') organizationId?: string,
    @Query('processInstanceId') processInstanceId?: string,
    @Query('incidentType') incidentType?: string,
    @Query('severity') severity?: string,
    @Query('status') status?: string,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ) {
    return this.incidents.list(this.tenant(user), { organizationId, processInstanceId, incidentType, severity, status, limit, offset });
  }

  @RequirePermissions('workflow.recovery.incidents.read')
  @Get(':id')
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.incidents.detail(this.tenant(user), id);
  }

  @RequirePermissions('workflow.recovery.incidents.manage')
  @Post(':id/acknowledge')
  acknowledge(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: { note?: string }) {
    return this.incidents.acknowledge(this.tenant(user), id, user.sub, body?.note);
  }

  @RequirePermissions('workflow.recovery.incidents.manage')
  @Post(':id/resolve')
  resolve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: { note: string }) {
    return this.incidents.resolve(this.tenant(user), id, user.sub, body?.note);
  }

  @RequirePermissions('workflow.recovery.incidents.manage')
  @Post(':id/replay')
  replay(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.incidents.replay(this.tenant(user), id, user.sub);
  }
}
