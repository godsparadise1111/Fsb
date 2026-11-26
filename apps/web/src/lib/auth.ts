// Browser-side session handling for F-S.
// Tokens stay in localStorage because every existing page already reads `fsb.accessToken` / `fsb.tenantId`.
// The access token is short-lived relative to the refresh token, and the API revokes sessions server-side on logout.

export const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api').replace(/\/$/, '');

export const STORAGE = {
  access: 'fsb.accessToken',
  refresh: 'fsb.refreshToken',
  tenant: 'fsb.tenantId',
  tenants: 'fsb.tenants',
} as const;

export type TenantChoice = { id: string; name: string; isTenantAdmin: boolean };
export type LoginResult = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; username: string; email: string; firstName: string; lastName: string };
  tenants: TenantChoice[];
};

const PUBLIC_PATHS = ['/', '/login', '/forgot-password', '/reset-password'];
export const isPublicPath = (path: string) => PUBLIC_PATHS.includes(path.replace(/\/+$/, '') || '/');

function read(key: string): string {
  try { return window.localStorage.getItem(key) ?? ''; } catch { return ''; }
}
function write(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* storage blocked: the session just will not persist */ }
}
function remove(key: string) {
  try { window.localStorage.removeItem(key); } catch { /* ignore */ }
}

export const getAccessToken = () => read(STORAGE.access);
export const getRefreshToken = () => read(STORAGE.refresh);
export const getTenantId = () => read(STORAGE.tenant);

export function getTenants(): TenantChoice[] {
  try {
    const parsed = JSON.parse(read(STORAGE.tenants) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function setTenant(id: string) {
  if (id) write(STORAGE.tenant, id); else remove(STORAGE.tenant);
}

export function saveSession(result: Pick<LoginResult, 'accessToken' | 'refreshToken'> & Partial<Pick<LoginResult, 'tenants'>>) {
  write(STORAGE.access, result.accessToken);
  write(STORAGE.refresh, result.refreshToken);
  if (result.tenants) {
    write(STORAGE.tenants, JSON.stringify(result.tenants));
    // Exactly one customer account: select it. Several: the person chooses on the login page.
    if (result.tenants.length === 1) write(STORAGE.tenant, result.tenants[0].id);
    else if (result.tenants.length === 0) remove(STORAGE.tenant);
  }
}

export function clearSession() {
  for (const key of Object.values(STORAGE)) remove(key);
}

/** Seconds since epoch of the token's `exp`, or null when it cannot be read. The signature is NOT verified here. */
export function tokenExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp : null;
  } catch { return null; }
}

export function isExpiringSoon(token: string, skewSeconds = 30): boolean {
  const exp = tokenExpiry(token);
  return exp !== null && exp - skewSeconds <= Date.now() / 1000;
}

/** Only same-site relative paths are allowed as a post-login destination (prevents open redirects). */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/tasks';
  return value;
}

type RefreshOutcome = 'ok' | 'denied' | 'error';
let refreshInFlight: Promise<RefreshOutcome> | null = null;

/** Exchanges the refresh token for a new pair. Concurrent callers share one request (the API rotates tokens). */
export function refreshSession(): Promise<RefreshOutcome> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async (): Promise<RefreshOutcome> => {
    const sent = getRefreshToken();
    if (!sent) return 'denied';
    try {
      const response = await window.fetch(API + '/auth/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: sent }),
      });
      if (response.ok) {
        const data = await response.json();
        saveSession({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        return 'ok';
      }
      // Another tab may have rotated the token a moment ago (the API tolerates that for a few seconds): use its result.
      await new Promise(resolve => setTimeout(resolve, 400));
      if (getRefreshToken() && getRefreshToken() !== sent) return 'ok';
      return response.status === 401 || response.status === 400 ? 'denied' : 'error';
    } catch {
      return 'error';
    } finally {
      setTimeout(() => { refreshInFlight = null; }, 0);
    }
  })();
  return refreshInFlight;
}

export function redirectToLogin() {
  if (typeof window === 'undefined' || isPublicPath(window.location.pathname)) return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign('/login?next=' + next);
}

let installed = false;

/**
 * Wraps window.fetch for calls to the F-S API so that every page gets, without changes:
 *  - the freshest access token (pages keep an older copy in React state),
 *  - a silent refresh shortly before expiry, and one retry after a 401,
 *  - a redirect to /login when the session is really over.
 * Requests built from a Request object are passed through untouched (their body may already be consumed).
 */
export function installAuthFetch() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const original = window.fetch.bind(window);
  const skip = /\/auth\/(login|refresh|forgot-password|reset-password)(\?|$)/;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : '';
    if (!url.startsWith(API + '/') || skip.test(url)) return original(input, init);
    const withToken = (token: string): RequestInit => {
      const headers = new Headers(init?.headers);
      if (token) headers.set('Authorization', 'Bearer ' + token);
      return { ...init, headers };
    };
    let token = getAccessToken();
    if (token && getRefreshToken() && isExpiringSoon(token)) {
      if ((await refreshSession()) === 'ok') token = getAccessToken();
    }
    let response = await original(input, withToken(token));
    if (response.status === 401 && getRefreshToken()) {
      const outcome = await refreshSession();
      if (outcome === 'ok') response = await original(input, withToken(getAccessToken()));
      else if (outcome === 'denied') { clearSession(); redirectToLogin(); }
    }
    return response;
  };
}

/** fetch with the current token and customer account headers, for the account pages. */
export function authedFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = getAccessToken();
  const tenant = getTenantId();
  if (token) headers.set('Authorization', 'Bearer ' + token);
  if (tenant) headers.set('X-Tenant-Id', tenant);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return window.fetch(API + path, { ...init, headers, cache: 'no-store' });
}

export async function apiError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => null);
  const message = data?.message;
  return Array.isArray(message) ? message.join('، ') : typeof message === 'string' ? message : fallback;
}

export async function loginRequest(username: string, password: string): Promise<LoginResult> {
  const response = await window.fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  if (response.status === 401) throw new Error('نام کاربری یا رمز عبور اشتباه است.');
  if (response.status === 429) throw new Error('تلاش‌های ناموفق بیش از حد مجاز بود. چند دقیقه بعد دوباره تلاش کنید.');
  if (!response.ok) throw new Error(await apiError(response, 'ورود ناموفق بود.'));
  return response.json();
}

export async function logoutRequest(): Promise<void> {
  const refreshToken = getRefreshToken();
  try {
    await authedFetch('/auth/logout', { method: 'POST', body: JSON.stringify(refreshToken ? { refreshToken } : {}) });
  } catch { /* the local session is cleared either way */ }
  clearSession();
}
