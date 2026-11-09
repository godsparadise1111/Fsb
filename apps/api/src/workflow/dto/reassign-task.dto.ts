import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class ReassignTaskDto {
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) assigneeUserIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) assigneePositionIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) assigneeUnitIds?: string[];
  @IsString() @Length(3, 1000) reason: string;
}
