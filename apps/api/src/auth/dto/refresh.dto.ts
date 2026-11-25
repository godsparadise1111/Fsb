import { IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class RefreshDto {
  @IsString() @Length(40, 200) refreshToken: string;
}

export class LogoutDto {
  @IsOptional() @IsString() @Length(40, 200) refreshToken?: string;
}

export class ChangePasswordDto {
  @IsString() @Length(1, 128) currentPassword: string;
  @IsString() @Length(10, 128) newPassword: string;
}

export class ForgotPasswordDto {
  @IsEmail() @MaxLength(190) email: string;
}

export class ResetPasswordDto {
  @IsString() @Length(40, 200) token: string;
  @IsString() @Length(10, 128) newPassword: string;
}
