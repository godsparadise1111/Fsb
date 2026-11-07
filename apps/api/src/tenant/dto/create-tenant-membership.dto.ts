import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class CreateTenantMembershipDto {
  @IsUUID() userId: string;
  @IsOptional() @IsBoolean() isTenantAdmin?: boolean;
}
