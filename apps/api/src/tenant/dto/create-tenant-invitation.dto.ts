import { IsBoolean, IsEmail, IsOptional } from 'class-validator';

export class CreateTenantInvitationDto {
  @IsEmail() email: string;
  @IsOptional() @IsBoolean() isTenantAdmin?: boolean;
}
