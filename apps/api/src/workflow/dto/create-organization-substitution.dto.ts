import { IsDateString, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateOrganizationSubstitutionDto {
  @IsUUID()
  organizationId: string;

  @IsUUID()
  originalUserId: string;

  @IsUUID()
  substituteUserId: string;

  @IsDateString()
  startsAt: string;

  @IsDateString()
  endsAt: string;

  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason: string;
}
