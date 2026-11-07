import { IsString, MinLength, MaxLength } from 'class-validator';

export class AcceptTenantInvitationDto {
  @IsString() @MinLength(32) @MaxLength(128) token: string;
}
