import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { IdentityService } from './identity.service';
import { CreateUserDto } from './dto/create-user.dto';
import { AssignPositionDto } from './dto/assign-position.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

class SetActiveDto { @IsBoolean() isActive: boolean; }
class GrantRoleDto { @IsUUID() userId: string; @IsUUID() roleId: string; @IsOptional() @IsUUID() organizationId?: string; }

@Controller()
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}
  @RequirePermissions('users.manage')
  @Post('users') createUser(@Body() dto: CreateUserDto) { return this.identity.createUser(dto); }
  @RequirePermissions('users.read')
  @Get('users') listUsers() { return this.identity.listUsers(); }
  @RequirePermissions('users.manage')
  @Patch('users/:id/active') setUserActive(@Param('id') id: string, @Body() dto: SetActiveDto) { return this.identity.setUserActive(id, dto.isActive); }
  @RequirePermissions('assignments.manage')
  @Post('user-positions') assignPosition(@Body() dto: AssignPositionDto) { return this.identity.assignPosition(dto); }
  @RequirePermissions('users.read')
  @Get('users/:id/positions') listUserPositions(@Param('id') id: string) { return this.identity.listUserPositions(id); }
  @RequirePermissions('permissions.manage')
  @Post('permissions') createPermission(@Body() dto: CreatePermissionDto) { return this.identity.createPermission(dto); }
  @RequirePermissions('permissions.manage')
  @Get('permissions') listPermissions() { return this.identity.listPermissions(); }
  @RequirePermissions('roles.manage')
  @Post('roles') createRole(@Body() dto: CreateRoleDto) { return this.identity.createRole(dto); }
  @RequirePermissions('roles.manage')
  @Get('roles') listRoles() { return this.identity.listRoles(); }
  @RequirePermissions('assignments.manage')
  @Post('user-roles') grantRole(@Body() dto: GrantRoleDto, @CurrentUser() actor: AuthenticatedUser) { return this.identity.grantRole(actor.sub, dto.userId, dto.roleId, dto.organizationId); }
}