'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { AuthCard, Message, fieldStyle, primaryButtonStyle } from '../../components/auth-card';
import { API, apiError, clearSession } from '../../lib/auth';

export default function ResetPasswordPage() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') ?? '');
    // Remove the one-time token from the address bar and history as soon as it has been read.
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (password.length < 10) return setError('رمز عبور باید حداقل ۱۰ نویسه باشد.');
    if (new TextEncoder().encode(password).length > 72) return setError('رمز عبور حداکثر ۷۲ بایت می‌تواند باشد (حدود ۳۶ حرف فارسی).');
    if (password !== confirm) return setError('تکرار رمز عبور با رمز وارد‌شده یکسان نیست.');
    setBusy(true);
    try {
      const response = await window.fetch(API + '/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, newPassword: password }),
      });
      if (!response.ok) setError(await apiError(response, 'تغییر رمز ناموفق بود.'));
      else { clearSession(); setDone(true); }
    } catch {
      setError('ارتباط با سرور برقرار نشد.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthCard title="رمز عبور تغییر کرد">
        <Message kind="success">رمز جدید ثبت شد و همه نشست‌های قبلی بسته شدند. اکنون وارد شوید.</Message>
        <a href="/login" style={{ color: '#1d4ed8' }}>ورود</a>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="تعیین رمز عبور جدید">
      {!token ? (
        <>
          <Message kind="error">لینک بازیابی ناقص است. دوباره درخواست بازیابی بدهید.</Message>
          <a href="/forgot-password" style={{ color: '#1d4ed8' }}>درخواست لینک جدید</a>
        </>
      ) : (
        <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
          <label>رمز عبور جدید
            <input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" required style={fieldStyle} dir="ltr" />
          </label>
          <label>تکرار رمز عبور
            <input type="password" value={confirm} onChange={event => setConfirm(event.target.value)} autoComplete="new-password" required style={fieldStyle} dir="ltr" />
          </label>
          <small style={{ color: '#667085' }}>حداقل ۱۰ نویسه؛ ترکیب حروف کوچک و بزرگ، عدد و نماد، یا یک عبارت ۱۶ نویسه‌ای به بالا. رمز نباید شامل نام کاربری یا بخشی از ایمیل باشد.</small>
          {error && <Message kind="error">{error}</Message>}
          <button type="submit" disabled={busy} style={primaryButtonStyle}>{busy ? 'در حال ثبت…' : 'ثبت رمز جدید'}</button>
        </form>
      )}
    </AuthCard>
  );
}
