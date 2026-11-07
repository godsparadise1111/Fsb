import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CreateTenantInvitationDto } from './dto/create-tenant-invitation.dto';
import { RegisterTenantInvitationDto } from './dto/register-tenant-invitation.dto';
import { Public } from '../auth/decorators/public.decorator';
import { AcceptTenantInvitationDto } from './dto/accept-tenant-invitation.dto';
import { TenantInvitationService } from './tenant-invitation.service';

@Controller('tenant/invitations')
export class TenantInvitationController {
  constructor(private readonly invitations: TenantInvitationService) {}

  private tenantId(user: AuthenticatedUser) {
    if (!user.tenantId) throw new BadRequestException('Select an active tenant before managing invitations');
    return user.tenantId;
  }

  @RequirePermissions('tenant.invitations.manage')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTenantInvitationDto) {
    return this.invitations.create(this.tenantId(user), user.sub, dto.email, dto.isTenantAdmin ?? false);
  }

  @RequirePermissions('tenant.invitations.read')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.invitations.list(this.tenantId(user));
  }

  @RequirePermissions('tenant.invitations.manage')
  @Delete(':id')
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.invitations.revoke(this.tenantId(user), id, user.sub);
  }

  @Public()
  @Post('register')
  register(@Body() dto: RegisterTenantInvitationDto) {
    return this.invitations.register(dto.token, dto);
  }

  // Authentication is required, but no tenant membership is required yet:
  // the invitation itself establishes the new tenant membership.
  @Post('accept')
  accept(@CurrentUser() user: AuthenticatedUser, @Body() dto: AcceptTenantInvitationDto) {
    return this.invitations.accept(dto.token, user.sub);
  }
}
