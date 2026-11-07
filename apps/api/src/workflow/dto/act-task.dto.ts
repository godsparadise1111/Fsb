import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
export class ActTaskDto {
  @IsIn(['APPROVED', 'REJECTED']) action: 'APPROVED' | 'REJECTED';
  @IsOptional() @IsString() @MaxLength(4000) comment?: string;
}