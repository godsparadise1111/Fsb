import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { REQUIRED_FEATURE_KEY } from '../decorators/requires-feature.decorator';

@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<string>(REQUIRED_FEATURE_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (!feature) return true;
    const request = context.switchToHttp().getRequest();
    const tenantId = request.user?.tenantId;
    if (!tenantId) throw new ForbiddenException('An active tenant context is required for this capability');
    const [row] = await this.dataSource.query(
      `SELECT (p.features ->> $2)::boolean AS enabled,
              s.status AS "subscriptionStatus",
              s."currentPeriodEnd" AS "periodEnd",
              s."trialEndsAt" AS "trialEndsAt",
              t.status AS "tenantStatus"
         FROM tenants t
         LEFT JOIN tenant_subscriptions s ON s."tenantId" = t.id
         LEFT JOIN commercial_plans p ON p.code = s."planCode"
        WHERE t.id = $1`,
      [tenantId, feature],
    );
    if (!row || row.tenantStatus !== 'ACTIVE') throw new ForbiddenException('Tenant is not active');
    const now = Date.now();
    const periodExpired = row.periodEnd && new Date(row.periodEnd).getTime() <= now;
    const trialExpired = row.subscriptionStatus === 'TRIALING' && row.trialEndsAt &&
      new Date(row.trialEndsAt).getTime() <= now;
    const subscriptionAllowed = ['ACTIVE', 'TRIALING'].includes(row.subscriptionStatus) &&
      !periodExpired && !trialExpired;
    if (!subscriptionAllowed || row.enabled !== true) {
      throw new ForbiddenException(`This capability is not included in the active tenant subscription: ${feature}`);
    }
    return true;
  }
}
