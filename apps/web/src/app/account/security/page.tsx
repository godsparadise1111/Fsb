'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AuthCard, Message, buttonStyle, dangerButtonStyle, fieldStyle, primaryButtonStyle } from '../../../components/auth-card';
import { apiError, authedFetch, clearSession, getTenantId, getTenants, logoutRequest, setTenant, type TenantChoice } from '../../../lib/auth';

type Session = { id: string; startedAt: string; lastRefreshedAt: string; userAgent: string | null; ipAddress: string | null; current: boolean };
type SecurityEvent = { eventType: string; ipAddress: string | null; userAgent: string | null; createdAt: string };

const EVENT_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: 'ورود موفق',
  LOGIN_FAILED: 'تلاش ناموفق برای ورود',
  LOGIN_BLOCKED: 'مسدود شدن موقت ورود به‌دلیل تلاش‌های ناموفق',
  LOGOUT: 'خروج',
  LOGOUT_ALL: 'خروج از همه دستگاه‌ها',
  SESSION_REVOKED: 'پایان دادن به یک نشست',
  TOKEN_REUSE_DETECTED: 'استفاده مشکوک از توکن قدیمی؛ نشست بسته شد',
  PASSWORD_CHANGED: 'تغییر رمز عبور',
  PASSWORD_CHANGE_FAILED: 'تلاش ناموفق برای تغییر رمز',
  PASSWORD_RESET_REQUESTED: 'درخواست بازیابی رمز',
  PASSWORD_RESET_COMPLETED: 'بازیابی رمز انجام شد',
  ROLE_GRANTED: 'نقش جدید به حساب شما داده شد',
  USER_ACTIVATION_CHANGED: 'وضعیت فعال بودن حساب تغییر کرد',
  POSITION_ASSIGNED: 'سمت سازمانی جدید به شما تخصیص یافت',
};

const when = (value: string) => new Date(value).toLocaleString('fa-IR');
const shortAgent = (value: string | null) => (value ? value.slice(0, 70) : 'نامشخص');

export default function AccountSecurityPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [tenants, setTenants] = useState<TenantChoice[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [sessionResponse, eventResponse] = await Promise.all([authedFetch('/auth/sessions'), authedFetch('/auth/security-events/me')]);
      if (sessionResponse.ok) setSessions(await sessionResponse.json());
      if (eventResponse.ok) setEvents(await eventResponse.json());
    } catch {
      setError('دریافت اطلاعات امنیتی ناموفق بود.');
    }
  }, []);

  useEffect(() => {
    setTenants(getTenants());
    setTenantId(getTenantId());
    void load();
  }, [load]);

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setError(''); setNotice('');
    if (next.length < 10) return setError('رمز جدید باید حداقل ۱۰ نویسه باشد.');
    if (new TextEncoder().encode(next).length > 72) return setError('رمز جدید حداکثر ۷۲ بایت می‌تواند باشد.');
    if (next !== confirm) return setError('تکرار رمز جدید یکسان نیست.');
    setBusy(true);
    try {
      const response = await authedFetch('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: next }) });
      if (!response.ok) setError(await apiError(response, 'تغییر رمز ناموفق بود.'));
      else {
        setNotice('رمز عبور تغییر کرد و نشست‌های دیگر شما بسته شدند.');
        setCurrent(''); setNext(''); setConfirm('');
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError(''); setNotice('');
    const response = await authedFetch('/auth/sessions/' + id, { method: 'DELETE' });
    if (!response.ok) setError(await apiError(response, 'پایان دادن به نشست ناموفق بود.'));
    else { setNotice('نشست بسته شد.'); await load(); }
  }

  async function logoutAll() {
    setBusy(true);
    await authedFetch('/auth/logout-all', { method: 'POST', body: '{}' }).catch(() => undefined);
    clearSession();
    window.location.assign('/login');
  }

  async function logout() {
    setBusy(true);
    await logoutRequest();
    window.location.assign('/login');
  }

  function switchTenant(event: FormEvent) {
    event.preventDefault();
    setTenant(tenantId);
    window.location.assign('/tasks');
  }

  const section = { display: 'grid', gap: 12, padding: '18px 0', borderTop: '1px solid #eaecf0' } as const;

  return (
    <AuthCard title="امنیت حساب" subtitle="رمز عبور، نشست‌های فعال و فعالیت‌های اخیر حساب شما" wide>
      {error && <Message kind="error">{error}</Message>}
      {notice && <Message kind="success">{notice}</Message>}

      <form onSubmit={changePassword} style={section}>
        <h2 style={{ margin: 0, fontSize: 17 }}>تغییر رمز عبور</h2>
        <label>رمز فعلی<input type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" required style={fieldStyle} dir="ltr" /></label>
        <label>رمز جدید<input type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" required style={fieldStyle} dir="ltr" /></label>
        <label>تکرار رمز جدید<input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" required style={fieldStyle} dir="ltr" /></label>
        <div><button type="submit" disabled={busy} style={primaryButtonStyle}>ثبت رمز جدید</button></div>
      </form>

      {tenants.length > 1 && (
        <form onSubmit={switchTenant} style={section}>
          <h2 style={{ margin: 0, fontSize: 17 }}>حساب مشتری فعال</h2>
          <select value={tenantId} onChange={e => setTenantId(e.target.value)} style={fieldStyle}>
            {tenants.map(item => <option key={item.id} value={item.id}>{item.name || item.id}{item.isTenantAdmin ? ' (مدیر)' : ''}</option>)}
          </select>
          <div><button type="submit" style={buttonStyle}>تغییر حساب</button></div>
        </form>
      )}

      <div style={section}>
        <h2 style={{ margin: 0, fontSize: 17 }}>نشست‌های فعال</h2>
        {!sessions.length && <p style={{ margin: 0, color: '#667085' }}>نشست فعالی ثبت نشده است. نشست‌های قبل از به‌روزرسانی امنیتی اینجا دیده نمی‌شوند.</p>}
        {sessions.map(item => (
          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', border: '1px solid #eaecf0', borderRadius: 10, padding: 12 }}>
            <div>
              <strong>{item.current ? 'نشست جاری' : 'دستگاه دیگر'}</strong>
              <div style={{ color: '#667085' }}>شروع: {when(item.startedAt)} · آخرین تمدید: {when(item.lastRefreshedAt)}</div>
              <small dir="ltr" style={{ color: '#667085' }}>{item.ipAddress ?? '—'} · {shortAgent(item.userAgent)}</small>
            </div>
            {!item.current && <button type="button" style={dangerButtonStyle} onClick={() => void revoke(item.id)}>پایان نشست</button>}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" disabled={busy} style={buttonStyle} onClick={() => void logout()}>خروج</button>
          <button type="button" disabled={busy} style={dangerButtonStyle} onClick={() => void logoutAll()}>خروج از همه دستگاه‌ها</button>
        </div>
      </div>

      <div style={section}>
        <h2 style={{ margin: 0, fontSize: 17 }}>فعالیت‌های اخیر حساب</h2>
        {!events.length && <p style={{ margin: 0, color: '#667085' }}>رویدادی ثبت نشده است.</p>}
        <ol style={{ margin: 0, paddingInlineStart: 20, display: 'grid', gap: 6 }}>
          {events.map((item, index) => (
            <li key={index}>
              {EVENT_LABELS[item.eventType] ?? item.eventType} · {when(item.createdAt)}
              <small dir="ltr" style={{ color: '#667085' }}> · {item.ipAddress ?? '—'}</small>
            </li>
          ))}
        </ol>
        <small style={{ color: '#667085' }}>اگر رویدادی را نمی‌شناسید، رمز عبور را تغییر دهید و «خروج از همه دستگاه‌ها» را بزنید.</small>
      </div>
    </AuthCard>
  );
}
