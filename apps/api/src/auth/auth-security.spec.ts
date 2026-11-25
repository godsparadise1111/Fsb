import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateRefreshToken,
  generateResetToken,
  hashRefreshToken,
  isLoginBlocked,
  isResetRequestThrottled,
  normalizeIdentity,
  passwordPolicyViolation,
  refreshTokenDays,
} from './auth-security';

test('refresh tokens are unpredictable and hashed as 64 hex chars', () => {
  const a = generateRefreshToken();
  const b = generateRefreshToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40 && a.length <= 200);
  assert.match(hashRefreshToken(a), /^[a-f0-9]{64}$/);
  assert.notEqual(hashRefreshToken(a), a);
  assert.equal(hashRefreshToken(a), hashRefreshToken(a));
});

test('identity is trimmed and lowercased', () => {
  assert.equal(normalizeIdentity('  Admin@Example.COM '), 'admin@example.com');
});

test('refresh lifetime falls back to 14 days on invalid configuration', () => {
  assert.equal(refreshTokenDays(undefined), 14);
  assert.equal(refreshTokenDays('30'), 30);
  assert.equal(refreshTokenDays('0'), 14);
  assert.equal(refreshTokenDays('abc'), 14);
  assert.equal(refreshTokenDays('1000'), 14);
  assert.equal(refreshTokenDays('2.5'), 14);
});

test('login throttling thresholds', () => {
  assert.equal(isLoginBlocked({ pair: 4, identity: 4 }), false);
  assert.equal(isLoginBlocked({ pair: 5, identity: 5 }), true);
  assert.equal(isLoginBlocked({ pair: 0, identity: 24 }), false);
  assert.equal(isLoginBlocked({ pair: 0, identity: 25 }), true);
});

test('password policy accepts strong passwords and passphrases', () => {
  assert.equal(passwordPolicyViolation('Str0ng!Passw0rd', { username: 'ali' }), null);
  assert.equal(passwordPolicyViolation('correct horse battery staple'), null);
  assert.equal(passwordPolicyViolation('کلمه عبور بسیار طولانی من'), null);
});

test('password policy rejects weak passwords', () => {
  assert.ok(passwordPolicyViolation('short1A!'));
  assert.ok(passwordPolicyViolation('aaaaaaaaaaaa'));
  assert.ok(passwordPolicyViolation('alllowercase'));
  assert.ok(passwordPolicyViolation('Xx1!ali.reza!Xx1', { username: 'Ali.Reza' }));
  assert.ok(passwordPolicyViolation('Mohammad#2026x', { email: 'mohammad@example.com' }));
});

test('password policy enforces the bcrypt 72-byte limit', () => {
  assert.equal(passwordPolicyViolation('Ab1!' + 'x'.repeat(68)), null);
  assert.ok(passwordPolicyViolation('Ab1!' + 'x'.repeat(69)));
  // Persian letters are 2 bytes in UTF-8: 36 characters = 72 bytes (allowed), 37 = 74 bytes (rejected).
  assert.equal(passwordPolicyViolation('کلمه'.repeat(9)), null);
  assert.ok(passwordPolicyViolation('کلمه'.repeat(9) + 'ک'));
});

test('reset tokens are unique and hash like refresh tokens', () => {
  const a = generateResetToken();
  assert.notEqual(a, generateResetToken());
  assert.ok(a.length >= 40 && a.length <= 200);
  assert.match(hashRefreshToken(a), /^[a-f0-9]{64}$/);
});

test('reset request throttling per user and per IP', () => {
  assert.equal(isResetRequestThrottled({ byUser: 2, byIp: 9 }), false);
  assert.equal(isResetRequestThrottled({ byUser: 3, byIp: 0 }), true);
  assert.equal(isResetRequestThrottled({ byUser: 0, byIp: 10 }), true);
});
