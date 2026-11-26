'use client';

import { useState, type FormEvent } from 'react';
import { AuthCard, Message, fieldStyle, primaryButtonStyle } from '../../components/auth-card';
import { API } from '../../lib/auth';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await window.fetch(API + '/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }),
      });
      if (response.status === 429) setError('درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.');
      else if (response.status === 400) setError('نشانی ایمیل معتبر نیست.');
      else if (!response.ok) setError('ارسال درخواست ناموفق بود. دوباره تلاش کنید.');
      else setDone(true);
    } catch {
      setError('ارتباط با سرور برقرار نشد.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="بازیابی رمز عبور" subtitle="ایمیل حساب خود را وارد کنید.">
      {done ? (
        <>
          <Message kind="success">اگر حسابی با این ایمیل وجود داشته باشد، لینک تعیین رمز جدید ارسال می‌شود. لینک ۳۰ دقیقه معتبر است و فقط یک بار کار می‌کند.</Message>
          <a href="/login" style={{ color: '#1d4ed8' }}>بازگشت به ورود</a>
        </>
      ) : (
        <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
          <label>ایمیل
            <input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required maxLength={190} style={fieldStyle} dir="ltr" />
          </label>
          {error && <Message kind="error">{error}</Message>}
          <button type="submit" disabled={busy} style={primaryButtonStyle}>{busy ? 'در حال ارسال…' : 'ارسال لینک بازیابی'}</button>
          <a href="/login" style={{ color: '#1d4ed8' }}>بازگشت به ورود</a>
        </form>
      )}
    </AuthCard>
  );
}
