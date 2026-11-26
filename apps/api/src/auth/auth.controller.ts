import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { AuthService, RequestContext } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto, ForgotPasswordDto, LogoutDto, RefreshDto, ResetPasswordDto } from './dto/refresh.dto';
import { CreateUserDto } from '../identity/dto/create-user.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from './decorators/current-user.decorator';

type HttpRequest = { ip?: string; headers: Record<string, string | string[] | undefined> };

function requestContext(request: HttpRequest): RequestContext {
  const agent = request.headers['user-agent'];
  return { ip: request.ip, userAgent: Array.isArray(agent) ? agent[0] : agent };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public() @Post('bootstrap') bootstrap(@Body() dto: CreateUserDto, @Headers('x-bootstrap-token') token?: string) { return this.auth.bootstrap(dto, token); }
  @Public() @Post('login') login(@Body() dto: LoginDto, @Req() request: HttpRequest) { return this.auth.login(dto, requestContext(request)); }
  @Public() @Post('refresh') refresh(@Body() dto: RefreshDto, @Req() request: HttpRequest) { return this.auth.refresh(dto.refreshToken, requestContext(request)); }
  @Post('logout') logout(@CurrentUser() user: AuthenticatedUser, @Body() dto: LogoutDto, @Req() request: HttpRequest) { return this.auth.logout(user.sub, user.sid, dto.refreshToken, requestContext(request)); }
  @Post('logout-all') logoutAll(@CurrentUser() user: AuthenticatedUser, @Req() request: HttpRequest) { return this.auth.logoutAll(user.sub, requestContext(request)); }
  @Get('sessions') sessions(@CurrentUser() user: AuthenticatedUser) { return this.auth.listSessions(user.sub, user.sid); }
  @Delete('sessions/:id') revokeSession(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Req() request: HttpRequest) { return this.auth.revokeSession(user.sub, id, requestContext(request)); }
  @Get('security-events/me') myEvents(@CurrentUser() user: AuthenticatedUser) { return this.auth.myRecentSecurityEvents(user.sub); }
  @Post('change-password') changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto, @Req() request: HttpRequest) { return this.auth.changePassword(user.sub, user.sid, dto, requestContext(request)); }
  @Public() @HttpCode(202) @Post('forgot-password') forgotPassword(@Body() dto: ForgotPasswordDto, @Req() request: HttpRequest) { return this.auth.requestPasswordReset(dto.email, requestContext(request)); }
  @Public() @HttpCode(200) @Post('reset-password') resetPassword(@Body() dto: ResetPasswordDto, @Req() request: HttpRequest) { return this.auth.confirmPasswordReset(dto.token, dto.newPassword, requestContext(request)); }
  @Get('me') me(@CurrentUser() user: AuthenticatedUser) { return this.auth.me(user.sub); }
}
