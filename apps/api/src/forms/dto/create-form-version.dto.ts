import { IsObject, IsOptional, IsString } from 'class-validator';
export class CreateFormVersionDto {
  @IsObject() schema: Record<string, unknown>;
  @IsOptional() @IsString() changeNote?: string;
}