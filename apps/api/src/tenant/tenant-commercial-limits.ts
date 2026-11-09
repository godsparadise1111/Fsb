import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

export interface TenantUserCapacity {
  maxUsers: number;
  activeMembers: number;
  pendingInvitations: number;
  reservedSeats: number;
}

/**
 * Call only after locking the tenant row. This locks the subscription next,
 * matching the tenant -> subscription order used by commercial operations.
 */
export async function assertTenantUserCapacity(
  manager: EntityManager,
  tenantId: string,
  mode: 'RESERVE_NEW_SEAT' | 'CONSUME_INVITATION',
): Promise<TenantUserCapacity> {
  const [subscription] = await manager.query(
    `SELECT p.limits,s.status,s."currentPeriodEnd",s."trialEndsAt"
       FROM tenant_subscriptions s
       JOIN commercial_plans p ON p.code=s."planCode"
      WHERE s."tenantId"=$1
      FOR UPDATE OF s`,
    [tenantId],
  );
  const now = Date.now();
  if (!subscription || !['ACTIVE','TRIALING'].includes(subscription.status) ||
      (subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd).getTime() <= now) ||
      (subscription.status === 'TRIALING' && subscription.trialEndsAt &&
       new Date(subscription.trialEndsAt).getTime() <= now)) {
    throw new ForbiddenException('Tenant subscription is not eligible for adding members');
  }
  const maxUsers = Number(subscription.limits?.maxUsers ?? 0);
  if (!Number.isSafeInteger(maxUsers) || maxUsers < 1) {
    throw new ForbiddenException('The active tenant plan has no valid user capacity');
  }
  const [active] = await manager.query(
    `SELECT count(*)::int AS count
       FROM tenant_memberships tm
       JOIN users u ON u.id=tm."userId" AND u."isActive"=true
      WHERE tm."tenantId"=$1 AND tm."isActive"=true`,
    [tenantId],
  );
  const [pending] = await manager.query(
    `SELECT count(*)::int AS count FROM tenant_invitations
      WHERE "tenantId"=$1 AND "acceptedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt">now()`,
    [tenantId],
  );
  const activeMembers = Number(active?.count ?? 0);
  const pendingInvitations = Number(pending?.count ?? 0);
  const reservedSeats = activeMembers + pendingInvitations;
  const full = mode === 'RESERVE_NEW_SEAT' ? reservedSeats >= maxUsers : reservedSeats > maxUsers;
  if (full) throw new BadRequestException('The active subscription user limit has been reached');
  return { maxUsers, activeMembers, pendingInvitations, reservedSeats };
}
