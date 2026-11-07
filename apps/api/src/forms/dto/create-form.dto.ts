import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
export class CreateFormDto {
  @IsUUID() organizationId: string;
  @IsString() @Length(2, 120) code: string;
  @IsString() @Length(2, 200) name: string;
  @IsOptional() @IsString() description?: string;
}