import { IsIn, IsOptional, IsUUID } from 'class-validator';
export class UpdateTenantStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'CLOSED']) status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  @IsOptional() @IsUUID() initialAdminUserId?: string;
}
