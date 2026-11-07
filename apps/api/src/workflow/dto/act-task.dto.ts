import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
export class ActTaskDto {
  @IsUUID() userId: string;
  @IsIn(['APPROVED', 'REJECTED']) action: 'APPROVED' | 'REJECTED';
  @IsOptional() @IsString() @MaxLength(4000) comment?: string;
}