import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { WorkflowService } from './workflow.service';
import { StartProcessDto } from './dto/start-process.dto';
import { ActTaskDto } from './dto/act-task.dto';

class UserQueryDto { @IsUUID() userId: string; }
@Controller()
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}
  @Post('process-instances') start(@Body() dto: StartProcessDto) { return this.workflow.startProcess(dto); }
  @Get('tasks/my') myTasks(@Query() query: UserQueryDto) { return this.workflow.listMyTasks(query.userId); }
  @Post('tasks/:id/actions') act(@Param('id') id: string, @Body() dto: ActTaskDto) { return this.workflow.act(id, dto); }
  @Get('tasks/:id/history') history(@Param('id') id: string) { return this.workflow.taskHistory(id); }
}