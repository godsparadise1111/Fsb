import { IsNotEmpty, IsString, IsUUID, IsOptional, Length, Matches } from 'class-validator';
export class CreateOrganizationDto {
  @IsOptional() @IsUUID() tenantId?: string;
  @IsString() @IsNotEmpty() @Length(2, 160) name: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{2,80}$/) code: string;
}
