import { IsArray, IsOptional, IsString, IsUUID, Length } from 'class-validator';
export class CreateRoleDto {
  @IsString() @Length(2, 80) code: string;
  @IsString() @Length(2, 160) name: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) permissionIds?: string[];
}