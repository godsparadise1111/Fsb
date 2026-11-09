"use client";

import { useCallback, useEffect, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api').replace(/\\/$/, '');
type Health = {
  platform: { recoveryWorkerConfigured: boolean; pollMs: number };
  totals: Record<string, number>;
  tenants: Array<{ id:string; name:string; code:string; status:string; plan:string; runningProcesses:number; activeTasks:number; activeIncidents:number; workerScans15m:number; lastWorkerScanAt:string|null; workerSignal:string }>;
  measuredAt:string; refreshAfterSeconds:number;
};
const fa = (v: number) => Number(v ?? 0).toLocaleString('fa-IR');
const date = (v?: string|null) => v ? new Date(v).toLocaleString('fa-IR') : 'ثبت نشده';

export default function PlatformWorkflowHealthPage() {
  const [token,setToken] = useState('');
  const [data,setData] = useState<Health|null>(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!token) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(API + '/platform/workflow-health',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
      const payload = await response.json().catch(()=>null);
      if (!response.ok) throw new Error(payload?.message || `خطای سرور (${response.status})`);
      setData(payload);
    } catch(e) { setError(e instanceof Error ? e.message : 'دریافت سلامت پلتفرم ناموفق بود'); }
    finally { setBusy(false); }
  },[token]);
  useEffect(()=>{const saved=localStorage.getItem('fsb.accessToken')||'';setToken(saved);},[]);
  useEffect(()=>{if(token) void load();},[token,load]);
  const cards = data ? [
    ['مشتریان فعال',data.totals.activeTenants],['فرایندهای در حال اجرا',data.totals.runningProcesses],
    ['وظایف فعال',data.totals.activeTasks],['وظایف معوق',data.totals.overdueTasks],
    ['رخدادهای بازیابی باز',data.totals.activeRecoveryIncidents],['اعلان‌های Dead Letter',data.totals.deadNotifications],
    ['Leaseهای منقضی اعلان',data.totals.expiredNotificationLeases],['رخدادهای بسته‌شده در ۲۴ ساعت',data.totals.resolvedRecoveryIncidents24h],
  ] : [];
  return <main dir="rtl" className="absence-shell">
    <header className="absence-header"><a className="absence-brand" href="/">F-S <span>مدیریت پلتفرم</span></a><a className="absence-back" href="/">بازگشت</a></header>
    <section className="absence-intro"><div><div className="absence-kicker">PLATFORM / WORKFLOW HEALTH</div><h1>سلامت تجمیعی موتور گردش‌کار</h1><p>نمای چندمشتری برای مدیر پلتفرم؛ داده‌های هر Tenant فقط در این نمای دارای مجوز تجمیع می‌شوند.</p></div><button className="absence-primary" onClick={()=>void load()} disabled={busy}>بروزرسانی</button></section>
    {error && <div className="absence-alert error">{error}</div>}
    {!token && <div className="absence-alert error">نشست ورود پیدا نشد؛ ابتدا از سامانه وارد شوید.</div>}
    {data && <>
      <section className="absence-panel"><div className="absence-panel-heading"><div><h2>وضعیت Worker بازیابی</h2><p>فعال‌بودن تنظیمات به‌تنهایی اثبات اجرای موفق Worker نیست.</p></div><span className={'absence-pill '+(data.platform.recoveryWorkerConfigured?'active':'cancelled')}>{data.platform.recoveryWorkerConfigured?'در تنظیمات فعال':'غیرفعال'}</span></div><p>فاصلهٔ پایش تنظیم‌شده: {fa(Math.round(data.platform.pollMs/1000))} ثانیه · زمان اندازه‌گیری: {date(data.measuredAt)}</p><p className="absence-form-note">سیگنال Worker فقط از رخدادهای دارای WORKER_SCAN قابل مشاهده است؛ نبود رخداد در ۱۵ دقیقه لزوماً به معنی خرابی Worker نیست، چون ممکن است رخداد قابل اسکن وجود نداشته باشد.</p></section>
      <section className="absence-summary">{cards.map(([label,value])=><article key={String(label)}><span>{label}</span><strong>{fa(Number(value))}</strong></article>)}</section>
      <section className="absence-panel"><div className="absence-panel-heading"><div><h2>وضعیت هر Tenant</h2><p>فقط Tenantهای فعال و تعلیق‌شده در این جدول نمایش داده می‌شوند.</p></div><span className="absence-step">{fa(data.tenants.length)} مشتری</span></div><div className="absence-table-wrap"><table className="absence-table" style={{minWidth:950}}><thead><tr><th>مشتری</th><th>وضعیت</th><th>فرایندهای فعال</th><th>وظایف فعال</th><th>رخدادهای باز</th><th>سیگنال Worker</th><th>آخرین مشاهده</th></tr></thead><tbody>{data.tenants.map(t=><tr key={t.id}><td><strong>{t.name}</strong><small>{t.code} · {t.plan}</small></td><td>{t.status==='ACTIVE'?'فعال':'تعلیق‌شده'}</td><td>{fa(t.runningProcesses)}</td><td>{fa(t.activeTasks)}</td><td><span className={'absence-pill '+(t.activeIncidents?'cancelled':'active')}>{fa(t.activeIncidents)}</span></td><td>{t.workerSignal==='OBSERVED'?'مشاهده شده':t.workerSignal==='FROZEN'?'متوقف به‌علت تعلیق':'بدون سیگنال اخیر'}</td><td>{date(t.lastWorkerScanAt)}</td></tr>)}{!data.tenants.length&&<tr><td colSpan={7}>Tenant فعالی برای نمایش وجود ندارد.</td></tr>}</tbody></table></div></section>
    </>}
    <footer className="absence-footer"><span>F-S · Platform Operations</span><span>Platform permission required · Read-only</span></footer>
  </main>;
}
