import { IsObject, IsOptional, IsUUID } from 'class-validator';
export class SubmitFormDto {
  @IsOptional() @IsUUID() processInstanceId?: string;
  @IsObject() data: Record<string, unknown>;
}