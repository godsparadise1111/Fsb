import assert from 'node:assert/strict';
import test from 'node:test';
import { FixedWindowRateLimiter, callerKey, parseTrustProxy, positiveInt, rateLimitMiddleware, securityHeadersMiddleware } from './http-security';

test('limiter allows up to max then blocks, then resets after the window', () => {
  let now = 1_000;
  const limiter = new FixedWindowRateLimiter({ windowMs: 60_000, max: 3, now: () => now });
  assert.deepEqual([1, 2, 3].map(() => limiter.hit('a').allowed), [true, true, true]);
  const blocked = limiter.hit('a');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1 && blocked.retryAfterSeconds <= 60);
  assert.equal(limiter.hit('b').allowed, true);
  now += 60_001;
  assert.equal(limiter.hit('a').allowed, true);
});

test('limiter memory stays bounded under a flood of unique keys', () => {
  const limiter = new FixedWindowRateLimiter({ windowMs: 60_000, max: 1, maxKeys: 100 });
  for (let i = 0; i < 1000; i += 1) limiter.hit('k' + i);
  assert.ok(limiter.size() <= 100, 'size was ' + limiter.size());
});

test('callers with tokens get their own bucket, anonymous callers share the IP bucket', () => {
  const a = callerKey({ ip: '10.0.0.1', headers: { authorization: 'Bearer aaaaaaaaaaaaaaaaaaaaaaaa' } });
  const b = callerKey({ ip: '10.0.0.1', headers: { authorization: 'Bearer bbbbbbbbbbbbbbbbbbbbbbbb' } });
  assert.notEqual(a, b);
  assert.equal(callerKey({ ip: '10.0.0.1', headers: {} }), 'ip:10.0.0.1');
  assert.match(callerKey({ ip: '10.0.0.1', headers: { 'x-fsb-api-key': 'fsb_live_123456789' } }), /^k:/);
});

test('middleware answers 429 with Retry-After and skips health probes', () => {
  const limiter = new FixedWindowRateLimiter({ windowMs: 60_000, max: 1 });
  const middleware = rateLimitMiddleware(limiter, () => 'same');
  const headers: Record<string, string> = {};
  let status = 0; let nexts = 0;
  const response = { setHeader: (n: string, v: string) => { headers[n] = v; }, status(code: number) { status = code; return this; }, json() {} };
  middleware({ path: '/api/tasks/my', headers: {} }, response, () => { nexts += 1; });
  middleware({ path: '/api/tasks/my', headers: {} }, response, () => { nexts += 1; });
  assert.equal(nexts, 1);
  assert.equal(status, 429);
  assert.ok(headers['Retry-After']);
  middleware({ path: '/api/health/ready', headers: {} }, response, () => { nexts += 1; });
  middleware({ path: '/api/health/ready', headers: {} }, response, () => { nexts += 1; });
  assert.equal(nexts, 3);
});

test('security headers: no-store, CSP, and HSTS only on secure requests', () => {
  const run = (secure: boolean, forceHsts = false) => {
    const headers: Record<string, string> = {};
    securityHeadersMiddleware({ forceHsts })({ secure, headers: {} }, { setHeader: (n, v) => { headers[n] = v; }, status() { return this as never; }, json() {} }, () => {});
    return headers;
  };
  assert.equal(run(false)['Cache-Control'], 'no-store');
  assert.match(run(false)['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(run(false)['Strict-Transport-Security'], undefined);
  assert.ok(run(true)['Strict-Transport-Security']);
  assert.ok(run(false, true)['Strict-Transport-Security']);
});

test('trust proxy accepts explicit hops/addresses and rejects blanket trust', () => {
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy('false'), false);
  assert.equal(parseTrustProxy('0'), false);
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy('loopback, 10.0.0.0/8'), 'loopback,10.0.0.0/8');
  assert.throws(() => parseTrustProxy('true'));
  assert.throws(() => parseTrustProxy('evil; drop'));
});

test('positiveInt falls back on invalid values', () => {
  assert.equal(positiveInt('120', 600), 120);
  assert.equal(positiveInt('abc', 600), 600);
  assert.equal(positiveInt('0', 600), 600);
  assert.equal(positiveInt(undefined, 600), 600);
});
