import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from '../identity/dto/create-user.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from './decorators/current-user.decorator';
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public() @Post('bootstrap') bootstrap(@Body() dto: CreateUserDto, @Headers('x-bootstrap-token') token?: string) { return this.auth.bootstrap(dto, token); }
  @Public() @Post('login') login(@Body() dto: LoginDto) { return this.auth.login(dto); }
  @Get('me') me(@CurrentUser() user: AuthenticatedUser) { return this.auth.me(user.sub); }
}