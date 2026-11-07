import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RequestTaskDeferralDto {
  @IsDateString()
  proposedDueAt: string;

  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason: string;
}

export class ReviewTaskDeferralDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
