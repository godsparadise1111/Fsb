import { IsBoolean, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
export class CreateUnitDto {
  @IsUUID() organizationId: string;
  @IsString() @Length(2, 160) name: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{2,80}$/) code: string;
  @IsOptional() @IsUUID() parentId?: string;
}
