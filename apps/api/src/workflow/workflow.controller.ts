import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { StartProcessDto } from './dto/start-process.dto';
import { ActTaskDto } from './dto/act-task.dto';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';

@Controller()
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}
  @RequirePermissions('workflow.start')
  @Post('process-instances') start(@Body() dto: StartProcessDto, @CurrentUser() user: AuthenticatedUser) { return this.workflow.startProcess({ ...dto, startedByUserId: user.sub }); }
  @RequirePermissions('workflow.tasks.read')
  @Get('tasks/my') myTasks(@CurrentUser() user: AuthenticatedUser) { return this.workflow.listMyTasks(user.sub); }
  @RequirePermissions('workflow.tasks.act')
  @Post('tasks/:id/actions') act(@Param('id') id: string, @Body() dto: ActTaskDto, @CurrentUser() user: AuthenticatedUser) { return this.workflow.act(id, user.sub, dto); }
  @RequirePermissions('workflow.history.read')
  @Get('tasks/:id/history') history(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) { return this.workflow.taskHistory(id, user.sub); }
}