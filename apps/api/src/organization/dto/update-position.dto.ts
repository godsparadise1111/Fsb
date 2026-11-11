import { IsOptional, IsString, Length, Matches } from 'class-validator';
export class UpdatePositionDto {
  @IsOptional() @IsString() @Length(2, 160) title?: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{2,80}$/) code?: string;
}
