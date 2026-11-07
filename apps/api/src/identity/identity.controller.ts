import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { IdentityService } from './identity.service';
import { CreateUserDto } from './dto/create-user.dto';
import { AssignPositionDto } from './dto/assign-position.dto';
import { CreateRoleDto } from './dto/create-role.dto';

class SetActiveDto { @IsBoolean() isActive: boolean; }
class GrantRoleDto { @IsUUID() userId: string; @IsUUID() roleId: string; @IsOptional() @IsUUID() organizationId?: string; }

@Controller()
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}
  @Post('users') createUser(@Body() dto: CreateUserDto) { return this.identity.createUser(dto); }
  @Get('users') listUsers() { return this.identity.listUsers(); }
  @Patch('users/:id/active') setUserActive(@Param('id') id: string, @Body() dto: SetActiveDto) { return this.identity.setUserActive(id, dto.isActive); }
  @Post('user-positions') assignPosition(@Body() dto: AssignPositionDto) { return this.identity.assignPosition(dto); }
  @Get('users/:id/positions') listUserPositions(@Param('id') id: string) { return this.identity.listUserPositions(id); }
  @Post('roles') createRole(@Body() dto: CreateRoleDto) { return this.identity.createRole(dto); }
  @Get('roles') listRoles() { return this.identity.listRoles(); }
  @Post('user-roles') grantRole(@Body() dto: GrantRoleDto) { return this.identity.grantRole(dto.userId, dto.roleId, dto.organizationId); }
}