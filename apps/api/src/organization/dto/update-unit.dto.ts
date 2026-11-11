import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
export class UpdateUnitDto {
  @IsOptional() @IsString() @Length(2, 160) name?: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{2,80}$/) code?: string;
  @IsOptional() @IsUUID() parentId?: string;
}
