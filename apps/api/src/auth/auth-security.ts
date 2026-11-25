import { createHash, randomBytes } from 'node:crypto';

/** Failed sign-ins are counted inside this sliding window. */
export const LOGIN_WINDOW_MINUTES = 15;
/** Max failures for one identity coming from one IP inside the window. */
export const MAX_FAILURES_PER_IDENTITY_AND_IP = 5;
/** Backstop for distributed guessing against one identity from many IPs. */
export const MAX_FAILURES_PER_IDENTITY = 25;
/** A just-rotated refresh token presented again inside this window is a race (two tabs), not theft. */
export const REFRESH_REUSE_GRACE_SECONDS = 10;

export function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase();
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenDays(raw: string | undefined = process.env.FSB_REFRESH_TOKEN_DAYS): number {
  const days = Number(raw ?? 14);
  return Number.isInteger(days) && days >= 1 && days <= 90 ? days : 14;
}

export function isLoginBlocked(counts: { pair: number; identity: number }): boolean {
  return counts.pair >= MAX_FAILURES_PER_IDENTITY_AND_IP || counts.identity >= MAX_FAILURES_PER_IDENTITY;
}

export interface PasswordContext {
  username?: string;
  email?: string;
}

/**
 * Returns a human-readable reason when the password is not acceptable, otherwise null.
 * bcrypt silently ignores everything after the 72nd BYTE, so the limit is in bytes (Persian letters take 2 bytes).
 */
export function passwordPolicyViolation(password: string, context: PasswordContext = {}): string | null {
  if (password.length < 10) return 'Password must be at least 10 characters';
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Password must be at most 72 bytes (about 72 Latin or 36 Persian characters)';
  if (/^(.)\1+$/u.test(password)) return 'Password must not repeat a single character';
  const lowered = password.toLowerCase();
  const username = context.username?.trim().toLowerCase();
  if (username && username.length >= 3 && lowered.includes(username)) return 'Password must not contain the username';
  const emailLocal = context.email?.split('@')[0]?.trim().toLowerCase();
  if (emailLocal && emailLocal.length >= 3 && lowered.includes(emailLocal)) return 'Password must not contain the email name';
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{N}]/u].filter(pattern => pattern.test(password)).length;
  // Letters without case (Persian) count as one class, so long passphrases are allowed instead of forcing symbols.
  if (classes < 3 && password.length < 16) return 'Use at least 16 characters, or mix three of: lowercase, uppercase, digits, symbols';
  return null;
}

/** Password reset links stay valid this long. */
export const PASSWORD_RESET_TTL_MINUTES = 30;
export const MAX_RESET_REQUESTS_PER_USER_PER_HOUR = 3;
export const MAX_RESET_REQUESTS_PER_IP_PER_HOUR = 10;

export function generateResetToken(): string {
  return randomBytes(48).toString('base64url');
}

export function isResetRequestThrottled(counts: { byUser: number; byIp: number }): boolean {
  return counts.byUser >= MAX_RESET_REQUESTS_PER_USER_PER_HOUR || counts.byIp >= MAX_RESET_REQUESTS_PER_IP_PER_HOUR;
}
