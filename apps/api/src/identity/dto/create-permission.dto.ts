import { IsOptional, IsString, Length } from 'class-validator';
export class CreatePermissionDto {
  @IsString() @Length(3, 120) code: string;
  @IsString() @Length(2, 160) name: string;
  @IsOptional() @IsString() description?: string;
}