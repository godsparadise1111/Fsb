import { IsDateString, IsUUID } from 'class-validator';

export class DelegateTaskDto {
  @IsUUID() toUserId: string;
  @IsDateString() endsAt: string;
}
