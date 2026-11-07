import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
export class CreateTenantDto {
  @IsString() @Length(2, 160) name: string;
  @IsString() @Length(3, 80) @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug: string;
  @IsString() @Length(2, 40) @Matches(/^[A-Z0-9_-]+$/) code: string;
  @IsOptional() @IsIn(['CORE', 'PROFESSIONAL', 'ENTERPRISE']) plan?: 'CORE' | 'PROFESSIONAL' | 'ENTERPRISE';
}
