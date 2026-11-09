import { IsIn, IsInt, IsString, MaxLength, MinLength, Min, ValidateIf } from 'class-validator';
export class ActTaskDto {
  @IsIn(['APPROVED', 'REJECTED', 'RETURNED']) action: 'APPROVED' | 'REJECTED' | 'RETURNED';
  @ValidateIf(dto => dto.action === 'RETURNED' || dto.comment !== undefined)
  @IsString() @MinLength(3) @MaxLength(4000)
  comment?: string;
  @ValidateIf(dto => dto.action === 'RETURNED')
  @IsInt() @Min(0)
  returnToStepIndex?: number;
}