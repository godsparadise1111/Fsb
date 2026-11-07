import { IsObject, IsOptional, IsString } from 'class-validator';
export class CreateProcessVersionDto {
  @IsObject() schema: Record<string, unknown>;
  @IsOptional() @IsString() changeNote?: string;
}