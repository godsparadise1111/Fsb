import { IsObject, IsOptional, IsUUID } from 'class-validator';
export class SubmitFormDto {
  @IsUUID() submittedByUserId: string;
  @IsOptional() @IsUUID() processInstanceId?: string;
  @IsObject() data: Record<string, unknown>;
}