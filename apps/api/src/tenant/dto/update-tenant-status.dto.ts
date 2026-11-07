import { IsIn } from 'class-validator';
export class UpdateTenantStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'CLOSED']) status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
}
