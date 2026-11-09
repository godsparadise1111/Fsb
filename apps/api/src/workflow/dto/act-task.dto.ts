import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';
export class ActTaskDto {
  @IsIn(['APPROVED', 'REJECTED', 'RETURNED']) action: 'APPROVED' | 'REJECTED' | 'RETURNED';
  @IsOptional() @IsString() @MaxLength(4000) comment?: string;
  @ValidateIf(dto => dto.action === 'RETURNED')
  @IsInt() @Min(0)
  returnToStepIndex?: number;
}