import { createHash } from 'node:crypto';

type Req = { ip?: string; path?: string; url?: string; secure?: boolean; headers: Record<string, string | string[] | undefined> };
type Res = { setHeader(name: string, value: string): void; status(code: number): Res; json(body: unknown): void };
type Next = () => void;

export interface RateLimitResult { allowed: boolean; remaining: number; retryAfterSeconds: number }

/** Fixed-window limiter kept in memory: fine for one API instance; use a shared store before scaling to several. */
export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly options: { windowMs: number; max: number; maxKeys?: number; now?: () => number }) {}

  hit(key: string): RateLimitResult {
    const now = (this.options.now ?? Date.now)();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.prune(now);
      bucket = { count: 0, resetAt: now + this.options.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return { allowed: bucket.count <= this.options.max, remaining: Math.max(0, this.options.max - bucket.count), retryAfterSeconds };
  }

  size() { return this.buckets.size; }

  private prune(now: number) {
    const maxKeys = this.options.maxKeys ?? 50000;
    if (this.buckets.size < maxKeys) return;
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
    if (this.buckets.size < maxKeys) return;
    // Still full of live buckets: drop the oldest tenth so memory stays bounded under a flood of unique keys.
    let toDrop = Math.ceil(maxKeys / 10);
    for (const key of this.buckets.keys()) { this.buckets.delete(key); if (--toDrop <= 0) break; }
  }
}

const sha = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);

/**
 * Per-caller key. A caller with a bearer token or API key gets its own bucket, so one shared proxy IP
 * (when FSB_TRUST_PROXY is not configured) cannot make a whole organisation share a single allowance.
 */
export function callerKey(request: Req): string {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ') && authorization.length > 20) return 'u:' + sha(authorization);
  const apiKey = request.headers['x-fsb-api-key'];
  if (typeof apiKey === 'string' && apiKey.length > 8) return 'k:' + sha(apiKey);
  return 'ip:' + (request.ip ?? 'unknown');
}

export function ipKey(request: Req): string { return 'ip:' + (request.ip ?? 'unknown'); }

const EXEMPT_PREFIXES = ['/api/health', '/api/metrics'];

export function rateLimitMiddleware(limiter: FixedWindowRateLimiter, key: (request: Req) => string, applies: (path: string) => boolean = () => true) {
  return (request: Req, response: Res, next: Next) => {
    const path = String(request.path ?? request.url ?? '').split('?')[0];
    if (EXEMPT_PREFIXES.some(prefix => path.startsWith(prefix)) || !applies(path)) return next();
    const result = limiter.hit(key(request));
    response.setHeader('X-RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) {
      response.setHeader('Retry-After', String(result.retryAfterSeconds));
      response.status(429).json({ statusCode: 429, message: 'Too many requests. Try again later.' });
      return;
    }
    next();
  };
}

export function securityHeadersMiddleware(options: { forceHsts?: boolean } = {}) {
  return (request: Req, response: Res, next: Next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // The API serves JSON and private files only; nothing it returns should ever be cached or framed.
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if (options.forceHsts || request.secure === true) response.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  };
}

const TRUST_TOKEN = /^(loopback|linklocal|uniquelocal|(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?|[0-9a-fA-F:]+(\/\d{1,3})?)$/;

/**
 * FSB_TRUST_PROXY: number of proxy hops ("1"), or a comma-separated list of loopback/linklocal/uniquelocal/addresses/CIDRs.
 * "true" is rejected on purpose: trusting every hop lets any client spoof X-Forwarded-For and dodge rate limits.
 */
export function parseTrustProxy(raw: string | undefined): false | number | string {
  const value = (raw ?? '').trim();
  if (!value || value.toLowerCase() === 'false') return false;
  if (/^\d{1,2}$/.test(value)) { const hops = Number(value); return hops === 0 ? false : hops; }
  const tokens = value.split(',').map(token => token.trim());
  if (tokens.some(token => !TRUST_TOKEN.test(token))) {
    throw new Error('FSB_TRUST_PROXY must be a hop count (for example 1) or a list of loopback/uniquelocal/IP/CIDR values; "true" is not allowed.');
  }
  return tokens.join(',');
}

export function positiveInt(raw: string | undefined, fallback: number, min = 1, max = 1_000_000): number {
  const value = Number(raw ?? fallback);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
