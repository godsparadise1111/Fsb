import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';

const ALLOWED_SCOPES = ['tenant.read', 'reports.read'] as const;
type ApiScope = typeof ALLOWED_SCOPES[number];

@Injectable()
export class TenantApiCredentialService {
  constructor(private readonly dataSource: DataSource) {}

  async issue(tenantId: string, actorUserId: string, name: string, scopes: string[], expiresAt?: string) {
    if (!Array.isArray(scopes) || scopes.length < 1 || scopes.length > 10 ||
        scopes.some(scope => !ALLOWED_SCOPES.includes(scope as ApiScope)) ||
        new Set(scopes).size !== scopes.length) {
      throw new BadRequestException('API credential scopes are invalid');
    }
    const expiry = expiresAt ? new Date(expiresAt) : null;
    if (expiry && (!Number.isFinite(expiry.getTime()) || expiry <= new Date())) {
      throw new BadRequestException('API credential expiry must be a future date');
    }
    return this.dataSource.transaction(async manager => {
      const [tenant] = await manager.query(
        `SELECT t.id FROM tenants t
          JOIN tenant_subscriptions s ON s."tenantId"=t.id
          JOIN commercial_plans p ON p.code=s."planCode"
         WHERE t.id=$1 AND t.status='ACTIVE'
           AND (p.features->>'api_access')::boolean=true
           AND s.status IN ('ACTIVE','TRIALING')
           AND (s."currentPeriodEnd" IS NULL OR s."currentPeriodEnd">now())
           AND (s.status<>'TRIALING' OR s."trialEndsAt" IS NULL OR s."trialEndsAt">now())
         FOR UPDATE OF t`,
        [tenantId],
      );
      if (!tenant) throw new ForbiddenException('API access is not enabled for this active tenant subscription');
      const prefix = 'fsb_live_' + randomBytes(5).toString('hex');
      const secret = randomBytes(32).toString('base64url');
      const fullKey = prefix + '.' + secret;
      const secretHash = createHash('sha256').update(fullKey).digest('hex');
      const [created] = await manager.query(
        `INSERT INTO tenant_api_credentials
          ("tenantId",name,"keyPrefix","secretHash",scopes,"expiresAt","createdByUserId")
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id,name,"keyPrefix",scopes,status,"expiresAt","createdAt"`,
        [tenantId, name.trim(), prefix, secretHash, scopes, expiry, actorUserId],
      );
      await manager.query(
        `INSERT INTO tenant_audit_logs ("tenantId","actorUserId",action,"resourceType","resourceId",metadata)
         VALUES ($1,$2,'API_CREDENTIAL_ISSUED','TENANT_API_CREDENTIAL',$3,$4::jsonb)`,
        [tenantId, actorUserId, created.id, JSON.stringify({ keyPrefix: prefix, scopes, expiresAt: expiry?.toISOString() ?? null })],
      );
      return { credential: created, key: fullKey, warning: 'این کلید فقط همین یک بار نمایش داده می‌شود؛ آن را در مخزن امن نگهداری کنید.' };
    });
  }

  async list(tenantId: string) {
    return this.dataSource.query(
      `SELECT id,name,"keyPrefix",scopes,status,"expiresAt","lastUsedAt","createdAt","revokedAt"
         FROM tenant_api_credentials WHERE "tenantId"=$1 ORDER BY "createdAt" DESC`,
      [tenantId],
    );
  }

  async revoke(tenantId: string, id: string, actorUserId: string) {
    return this.dataSource.transaction(async manager => {
      const [row] = await manager.query(
        `UPDATE tenant_api_credentials SET status='REVOKED',"revokedAt"=now()
          WHERE id=$1 AND "tenantId"=$2 AND status='ACTIVE'
          RETURNING id,"keyPrefix",status,"revokedAt"`,
        [id, tenantId],
      );
      if (!row) throw new NotFoundException('Active API credential not found');
      await manager.query(
        `INSERT INTO tenant_audit_logs ("tenantId","actorUserId",action,"resourceType","resourceId",metadata)
         VALUES ($1,$2,'API_CREDENTIAL_REVOKED','TENANT_API_CREDENTIAL',$3,$4::jsonb)`,
        [tenantId, actorUserId, id, JSON.stringify({ keyPrefix: row.keyPrefix })],
      );
      return row;
    });
  }

  async authenticate(rawKey: string, requiredScope: ApiScope) {
    if (typeof rawKey !== 'string' || rawKey.length > 160 || !/^fsb_live_[a-f0-9]{10}\.[A-Za-z0-9_-]{40,50}$/.test(rawKey)) {
      throw new UnauthorizedException('Invalid API credential');
    }
    const prefix = rawKey.slice(0, rawKey.indexOf('.'));
    const [credential] = await this.dataSource.query(
      `SELECT c.id,c."tenantId",c."secretHash",c.scopes
         FROM tenant_api_credentials c
         JOIN tenants t ON t.id=c."tenantId" AND t.status='ACTIVE'
         JOIN tenant_subscriptions s ON s."tenantId"=t.id AND s.status IN ('ACTIVE','TRIALING')
         JOIN commercial_plans p ON p.code=s."planCode" AND (p.features->>'api_access')::boolean=true
        WHERE c."keyPrefix"=$1 AND c.status='ACTIVE'
          AND (c."expiresAt" IS NULL OR c."expiresAt">now())
          AND (s."currentPeriodEnd" IS NULL OR s."currentPeriodEnd">now())
          AND (s.status<>'TRIALING' OR s."trialEndsAt" IS NULL OR s."trialEndsAt">now())`,
      [prefix],
    );
    if (!credential) throw new UnauthorizedException('Invalid or inactive API credential');
    const expected = Buffer.from(credential.secretHash, 'hex');
    const actual = Buffer.from(createHash('sha256').update(rawKey).digest('hex'), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException('Invalid API credential');
    }
    if (!credential.scopes.includes(requiredScope)) throw new ForbiddenException('API credential lacks the required scope');
    await this.dataSource.query('UPDATE tenant_api_credentials SET "lastUsedAt"=now() WHERE id=$1', [credential.id]);
    const [tenant] = await this.dataSource.query(
      'SELECT id,name,slug,code,status,plan FROM tenants WHERE id=$1',
      [credential.tenantId],
    );
    if (!tenant) throw new UnauthorizedException('Tenant is unavailable');
    return { tenant, credentialId: credential.id, scopes: credential.scopes as string[] };
  }
}
