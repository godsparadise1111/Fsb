import assert from 'node:assert/strict';
import test from 'node:test';
import { identityFingerprint, recordSecurityEvent, sanitizeMetadata } from './security-events';

test('identity fingerprint is stable, case-insensitive and short', () => {
  assert.equal(identityFingerprint('Ali@Example.com '), identityFingerprint('ali@example.com'));
  assert.match(identityFingerprint('x'), /^[a-f0-9]{32}$/);
  assert.notEqual(identityFingerprint('a'), identityFingerprint('b'));
});

test('metadata drops secret-looking keys, truncates long strings and caps key count', () => {
  const clean = sanitizeMetadata({ reason: 'x'.repeat(500), password: 'p', refreshToken: 't', apiKey: 'k', role: 'ADMIN' })!;
  assert.deepEqual(Object.keys(clean).sort(), ['reason', 'role']);
  assert.equal((clean.reason as string).length, 200);
  assert.equal(sanitizeMetadata(undefined), null);
  assert.equal(sanitizeMetadata({ password: 'x' }), null);
  assert.equal(Object.keys(sanitizeMetadata(Object.fromEntries(Array.from({ length: 50 }, (_, i) => ['k' + i, i])))!).length, 20);
});

test('recording never throws and never stores the raw identity', async () => {
  const calls: unknown[][] = [];
  await recordSecurityEvent({ query: async (_sql, params) => { calls.push(params ?? []); } }, { type: 'LOGIN_FAILED', identity: 'secret-typed-text', ip: '1.2.3.4' });
  assert.equal(calls.length, 1);
  assert.ok(!JSON.stringify(calls[0]).includes('secret-typed-text'));
  await assert.doesNotReject(recordSecurityEvent({ query: async () => { throw new Error('db down'); } }, { type: 'LOGOUT' }));
});

test('dedupe uses the guarded insert with the window as the last parameter', async () => {
  let sql = ''; let params: unknown[] = [];
  await recordSecurityEvent({ query: async (s, p) => { sql = s; params = p ?? []; } }, { type: 'LOGIN_BLOCKED', identity: 'a', ip: '1.1.1.1', dedupeMinutes: 15 });
  assert.match(sql, /WHERE NOT EXISTS/);
  assert.equal(params[params.length - 1], 15);
});
