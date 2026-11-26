'use client';

import { useState, type FormEvent } from 'react';
import { AuthCard, Message, fieldStyle, primaryButtonStyle } from '../../components/auth-card';
import { clearSession, loginRequest, safeNext, saveSession, setTenant, type TenantChoice } from '../../lib/auth';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tenants, setTenants] = useState<TenantChoice[] | null>(null);
  const [tenantId, setTenantId] = useState('');

  const destination = () => safeNext(new URLSearchParams(window.location.search).get('next'));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      clearSession();
      const result = await loginRequest(username.trim(), password);
      saveSession(result);
      setPassword('');
      if (result.tenants.length > 1) {
        setTenants(result.tenants);
        setTenantId(result.tenants[0].id);
      } else {
        window.location.assign(destination());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ورود ناموفق بود.');
    } finally {
      setBusy(false);
    }
  }

  function chooseTenant(event: FormEvent) {
    event.preventDefault();
    setTenant(tenantId);
    window.location.assign(destination());
  }

  if (tenants) {
    return (
      <AuthCard title="انتخاب حساب مشتری" subtitle="شما عضو چند حساب مشتری هستید. حساب موردنظر را انتخاب کنید.">
        <form onSubmit={chooseTenant} style={{ display: 'grid', gap: 14 }}>
          <label>حساب مشتری
            <select value={tenantId} onChange={event => setTenantId(event.target.value)} style={fieldStyle}>
              {tenants.map(item => <option key={item.id} value={item.id}>{item.name || item.id}{item.isTenantAdmin ? ' (مدیر)' : ''}</option>)}
            </select>
          </label>
          <button type="submit" style={primaryButtonStyle}>ادامه</button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="ورود به F-S" subtitle="با نام کاربری یا ایمیل خود وارد شوید.">
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
        <label>نام کاربری یا ایمیل
          <input value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" required minLength={3} maxLength={190} style={fieldStyle} dir="ltr" />
        </label>
        <label>رمز عبور
          <input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required minLength={8} maxLength={128} style={fieldStyle} dir="ltr" />
        </label>
        {error && <Message kind="error">{error}</Message>}
        <button type="submit" disabled={busy} style={primaryButtonStyle}>{busy ? 'در حال ورود…' : 'ورود'}</button>
        <a href="/forgot-password" style={{ color: '#1d4ed8' }}>رمز عبور را فراموش کرده‌اید؟</a>
      </form>
    </AuthCard>
  );
}
