import { IsBoolean, IsIn, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
export class UpdateTenantSubscriptionDto {
  @IsString() @Length(3, 24) @Matches(/^[A-Z_]+$/) planCode: string;
  @IsIn(['TRIALING','ACTIVE','PAST_DUE','SUSPENDED','CANCELLED']) status: 'TRIALING'|'ACTIVE'|'PAST_DUE'|'SUSPENDED'|'CANCELLED';
  @IsIn(['MONTHLY','ANNUAL']) billingCycle: 'MONTHLY'|'ANNUAL';
  @IsOptional() @IsISO8601() periodStart?: string;
  @IsOptional() @IsISO8601() periodEnd?: string | null;
  @IsOptional() @IsISO8601() trialEndsAt?: string | null;
  @IsOptional() @IsBoolean() cancelAtPeriodEnd?: boolean;
}
export class CreateTenantInvoiceDto {
  @IsString() @Length(3,64) @Matches(/^[A-Za-z0-9_-]+$/) invoiceNumber: string;
  @IsString() @Matches(/^[A-Z]{3}$/) currencyCode: string;
  @IsInt() @Min(0) subtotalMinor: number;
  @IsInt() @Min(0) taxMinor: number;
  @IsString() @Length(1,1000) description: string;
  @IsOptional() @IsISO8601() dueAt?: string;
}
export class TransitionInvoiceDto {
  @IsIn(['PAID','VOID']) status: 'PAID'|'VOID';
}

export class RenewTenantSubscriptionDto {
  @IsUUID() invoiceId: string;
}
