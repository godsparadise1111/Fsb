import { IsString, IsUUID, Length, Matches } from 'class-validator';
export class CreatePositionDto {
  @IsUUID() organizationUnitId: string;
  @IsString() @Length(2, 160) title: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{2,80}$/) code: string;
}
