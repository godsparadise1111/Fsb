import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { StartProcessDto } from './dto/start-process.dto';
import { ActTaskDto } from './dto/act-task.dto';
import { DelegateTaskDto } from './dto/delegate-task.dto';
import { RequestTaskDeferralDto, ReviewTaskDeferralDto } from './dto/request-task-deferral.dto';
import { CreateOrganizationSubstitutionDto } from './dto/create-organization-substitution.dto';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';

@Controller()
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}
  @RequirePermissions('workflow.start')
  @Post('process-instances') start(@Body() dto: StartProcessDto, @CurrentUser() user: AuthenticatedUser) { return this.workflow.startProcess({ ...dto, startedByUserId: user.sub }); }
  @RequirePermissions('workflow.tasks.read')
  @Get('tasks/my') myTasks(@CurrentUser() user: AuthenticatedUser) { return this.workflow.listMyTasks(user.sub, user.tenantId); }
  @RequirePermissions('workflow.tasks.act')
  @Post('tasks/:id/actions') act(@Param('id') id: string, @Body() dto: ActTaskDto, @CurrentUser() user: AuthenticatedUser) { return this.workflow.act(id, user.sub, dto, user.tenantId); }
  @RequirePermissions('workflow.tasks.act')
  @Post('tasks/:id/delegations')
  delegate(@Param('id') id: string, @Body() dto: DelegateTaskDto, @CurrentUser() user: AuthenticatedUser) {
    return this.workflow.delegateTask(id, user.sub, dto, user.tenantId);
  }
  @RequirePermissions('workflow.history.read')
  @Get('tasks/:id/delegations')
  delegations(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workflow.listTaskDelegations(id, user.sub, user.tenantId);
  }
  @RequirePermissions('workflow.tasks.act')
  @Delete('tasks/:id/delegations/:delegationId')
  revokeDelegation(@Param('id') id: string, @Param('delegationId') delegationId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workflow.revokeTaskDelegation(id, delegationId, user.sub, user.tenantId);
  }


  @RequirePermissions('workflow.substitutions.manage')
  @Post('organization-substitutions')
  createSubstitution(@Body() dto: CreateOrganizationSubstitutionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.workflow.createOrganizationSubstitution(user.sub, dto, user.tenantId);
  }
  @RequirePermissions('workflow.substitutions.manage')
  @Get('organizations/:organizationId/substitutions')
  substitutions(@Param('organizationId') organizationId: string, @Query('limit') limit: string, @Query('offset') offset: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workflow.listOrganizationSubstitutions(organizationId, user.tenantId, limit, offset);
  }
  @RequirePermissions('workflow.substitutions.manage')
  @Delete('organizations/:organizationId/substitutions/:substitutionId')
  revokeSubstitution(@Param('organizationId') organizationId: string, @Param('substitutionId') substitutionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workflow.revokeOrganizationSubstitution(organizationId, substitutionId, user.sub, user.tenantId);
  }

  @RequirePermissions('workflow.tasks.defer.approve')
  @Get('tasks/deferrals/pending')
  pendingDeferrals(@Query('organizationId') organizationId: string, @Query('limit') limit: string, @Query('offset') offset: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workflow.listPendingTaskDeferrals(organizationId, user.tenantId, limit, offset);
  }
  @RequirePermissions('workflow.tasks.act')
  @Post('tasks/:id/deferrals')
  requestDeferral(@Param('id') id: string, @Body() dto: RequestTaskDeferralDto, @CurrentUser() user: AuthenticatedUser) {
    return this.workflow.requestTaskDeferral(id, user.sub, dto, user.tenantId);
  }
  @RequirePermissions('workflow.history.read')
  @Get('tasks/:id/deferrals')
  deferrals(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workflow.listTaskDeferrals(id, user.sub, user.tenantId);
  }
  @RequirePermissions('workflow.tasks.defer.approve')
  @Post('tasks/:id/deferrals/:requestId/approve')
  approveDeferral(@Param('id') id: string, @Param('requestId') requestId: string, @Body() dto: ReviewTaskDeferralDto, @CurrentUser() user: AuthenticatedUser) {
    return this.workflow.reviewTaskDeferral(id, requestId, user.sub, 'APPROVED', dto, user.tenantId);
  }
  @RequirePermissions('workflow.tasks.defer.approve')
  @Post('tasks/:id/deferrals/:requestId/reject')
  rejectDeferral(@Param('id') id: string, @Param('requestId') requestId: string, @Body() dto: ReviewTaskDeferralDto, @CurrentUser() user: AuthenticatedUser) {
    return this.workflow.reviewTaskDeferral(id, requestId, user.sub, 'REJECTED', dto, user.tenantId);
  }
  @RequirePermissions('workflow.history.read')
  @Get('tasks/:id/history') history(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) { return this.workflow.taskHistory(id, user.sub, user.tenantId); }
}