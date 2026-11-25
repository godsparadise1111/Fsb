import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';

export type SecurityEventType =
  | 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'LOGIN_BLOCKED'
  | 'LOGOUT' | 'LOGOUT_ALL' | 'SESSION_REVOKED' | 'TOKEN_REUSE_DETECTED'
  | 'PASSWORD_CHANGED' | 'PASSWORD_CHANGE_FAILED'
  | 'PASSWORD_RESET_REQUESTED' | 'PASSWORD_RESET_COMPLETED'
  | 'ROLE_GRANTED' | 'ROLE_REVOKED' | 'USER_ACTIVATION_CHANGED' | 'POSITION_ASSIGNED';

export interface SecurityEventInput {
  type: SecurityEventType;
  userId?: string | null;
  identity?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  /** Skip the insert when an identical event (same type, identity, IP) was already recorded this recently. */
  dedupeMinutes?: number;
}

type Queryable = { query(sql: string, params?: unknown[]): Promise<unknown> };
const logger = new Logger('SecurityEvents');

export function identityFingerprint(identity: string): string {
  return createHash('sha256').update(identity.trim().toLowerCase()).digest('hex').slice(0, 32);
}

/** Keeps metadata small and free of secrets-looking keys before it reaches the database. */
export function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!metadata) return null;
  const blocked = /pass|token|secret|authorization|cookie|key/i;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata).slice(0, 20)) {
    if (blocked.test(key)) continue;
    clean[key] = typeof value === 'string' ? value.slice(0, 200) : value;
  }
  return Object.keys(clean).length ? clean : null;
}

/**
 * Records a security event on its OWN connection (never pass a manager that is inside a transaction:
 * a failed insert would poison that transaction). A failure to audit is logged but never breaks the request.
 */
export async function recordSecurityEvent(db: Queryable, input: SecurityEventInput): Promise<void> {
  try {
    const identityHash = input.identity ? identityFingerprint(input.identity) : null;
    const params = [
      input.type, input.userId ?? null, identityHash, (input.ip ?? '').slice(0, 64) || null,
      (input.userAgent ?? '').slice(0, 255) || null, sanitizeMetadata(input.metadata) ? JSON.stringify(sanitizeMetadata(input.metadata)) : null,
    ];
    if (input.dedupeMinutes && input.dedupeMinutes > 0) {
      await db.query(
        `INSERT INTO auth_security_events ("eventType","userId","identityHash","ipAddress","userAgent",metadata)
         SELECT $1,$2,$3,$4,$5,$6::jsonb
          WHERE NOT EXISTS (
            SELECT 1 FROM auth_security_events
             WHERE "eventType" = $1 AND "identityHash" IS NOT DISTINCT FROM $3 AND "ipAddress" IS NOT DISTINCT FROM $4
               AND "createdAt" > now() - make_interval(mins => $7::int))`,
        [...params, input.dedupeMinutes],
      );
      return;
    }
    await db.query(
      `INSERT INTO auth_security_events ("eventType","userId","identityHash","ipAddress","userAgent",metadata)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      params,
    );
  } catch (error) {
    logger.warn(`Could not record ${input.type}: ${String(error).slice(0, 200)}`);
  }
}
