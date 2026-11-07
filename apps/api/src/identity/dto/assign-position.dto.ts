import { IsBoolean, IsDateString, IsOptional, IsUUID } from 'class-validator';
export class AssignPositionDto {
  @IsUUID() userId: string;
  @IsUUID() positionId: string;
  @IsOptional() @IsDateString() validFrom?: string;
  @IsOptional() @IsDateString() validUntil?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}