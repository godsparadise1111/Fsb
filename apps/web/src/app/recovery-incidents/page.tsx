"use client";

import { FormEvent, useCallback, useEffect, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api').replace(/\/$/, '');
type Organization = { id: string; name: string };
type Incident = {
  id: string; processInstanceId: string; incidentType: string; details: Record<string, unknown>;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'; createdAt: string; updatedAt: string; resolvedAt: string | null;
  processTitle: string; processStatus: string; organizationId: string; organizationName: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM'; eventCount: number;
};
type Event = { id: string; eventType: string; actorUserId: string | null; eventKey: string; metadata: Record<string, unknown>; createdAt: string };
type Detail = { incident: Incident; events: Event[]; lifecycle: Array<{ id: string; taskId: string; eventType: string; details: Record<string, unknown>; createdAt: string }> };
const faDate = (value?: string | null) => value ? new Date(value).toLocaleString('fa-IR') : '—';
const typeLabel = (type: string) => type === 'RUNNING_PROCESS_TASK_COUNT_MISMATCH' ? 'ناهماهنگی وظایف فرایند در حال اجرا' : type === 'TERMINAL_PROCESS_HAS_ACTIVE_TASKS' ? 'وجود وظیفه فعال در فرایند خاتمه‌یافته' : type;
const statusLabel = (status: string) => (({ OPEN: 'باز', ACKNOWLEDGED: 'در حال رسیدگی', RESOLVED: 'بسته‌شده' }) as Record<string, string>)[status] || status;
const severityLabel = (severity: string) => (({ CRITICAL: 'بحرانی', HIGH: 'زیاد', MEDIUM: 'متوسط' }) as Record<string, string>)[severity] || severity;

export default function RecoveryIncidentsPage() {
  const [token, setToken] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [items, setItems] = useState<Incident[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [organizationId, setOrganizationId] = useState('');
  const [processInstanceId, setProcessInstanceId] = useState('');
  const [incidentType, setIncidentType] = useState('');
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(API + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}), ...(init.headers || {}) },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.message;
      throw new Error(Array.isArray(message) ? message.join('، ') : message || `خطای سرور (${response.status})`);
    }
    return payload;
  }, [token, tenantId]);

  const load = useCallback(async () => {
    if (!token) return;
    setBusy(true); setError('');
    try {
      const params = new URLSearchParams({ status, limit: '50', offset: '0' });
      if (organizationId) params.set('organizationId', organizationId);
      if (processInstanceId.trim()) params.set('processInstanceId', processInstanceId.trim());
      if (incidentType) params.set('incidentType', incidentType);
      if (severity) params.set('severity', severity);
      const result = await request('/workflow/recovery-incidents?' + params.toString());
      setItems(result.items || []);
      if (detail) {
        const stillVisible = (result.items || []).some((item: Incident) => item.id === detail.incident.id);
        if (!stillVisible && status === 'ACTIVE') setDetail(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'دریافت رخدادها ناموفق بود');
    } finally { setBusy(false); }
  }, [token, request, status, organizationId, processInstanceId, incidentType, severity, detail]);

  const openDetail = async (id: string) => {
    setBusy(true); setError('');
    try { setDetail(await request('/workflow/recovery-incidents/' + id)); setNote(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'دریافت جزئیات ناموفق بود'); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const savedToken = localStorage.getItem('fsb.accessToken') || '';
    const savedTenant = localStorage.getItem('fsb.tenantId') || '';
    setTenantId(savedTenant);
    if (savedToken) { setToken(savedToken); setLoggedIn(true); }
  }, []);

  useEffect(() => {
    if (!loggedIn || !token) return;
    void request('/organizations/accessible').then((rows: Organization[]) => setOrganizations(rows || []))
      .catch(e => setError(e instanceof Error ? e.message : 'دریافت سازمان‌ها ناموفق بود'));
  }, [loggedIn, token, request]);

  useEffect(() => { if (loggedIn && token) void load(); }, [loggedIn, token, load]);

  async function login(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || 'ورود ناموفق بود');
      localStorage.setItem('fsb.accessToken', payload.accessToken);
      if (tenantId.trim()) localStorage.setItem('fsb.tenantId', tenantId.trim());
      else localStorage.removeItem('fsb.tenantId');
      setToken(payload.accessToken); setLoggedIn(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'ورود ناموفق بود'); }
    finally { setBusy(false); }
  }

  async function act(action: 'acknowledge' | 'resolve' | 'replay') {
    if (!detail) return;
    if (action === 'resolve' && note.trim().length < 5) { setError('برای بستن رخداد، توضیح اصلاح حداقل ۵ نویسه‌ای وارد کنید.'); return; }
    if (action === 'replay' && !window.confirm('هیچ Replay برای این نوع رخداد مجاز نیست. درخواست ردشده ثبت و ممیزی می‌شود؛ ادامه می‌دهید؟')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await request(`/workflow/recovery-incidents/${detail.incident.id}/${action}`, {
        method: 'POST', body: JSON.stringify(action === 'acknowledge' ? { note: note.trim() || undefined } : action === 'resolve' ? { note: note.trim() } : {}),
      });
      setNotice(action === 'acknowledge' ? 'رسیدگی به رخداد تأیید شد.' : action === 'resolve' ? 'رخداد با ثبت یادداشت ممیزی بسته شد.' : 'درخواست Replay به‌صورت امن رد و در Audit ثبت شد.');
      if (action !== 'replay') await openDetail(detail.incident.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'عملیات ناموفق بود');
      if (action === 'replay') await openDetail(detail.incident.id);
    } finally { setBusy(false); }
  }

  if (!loggedIn) return <main dir="rtl" className="absence-shell"><section className="absence-login"><h1>مدیریت رخدادهای بازیابی گردش‌کار</h1><p>برای مشاهده رخدادهای Tenant وارد شوید. دسترسی فقط برای مدیر مجاز همان مشتری فعال است.</p><form className="absence-form" onSubmit={login}><label>نام کاربری<input value={username} onChange={e => setUsername(e.target.value)} required /></label><label>گذرواژه<input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label><label>شناسه مشتری (در صورت نیاز)<input value={tenantId} onChange={e => setTenantId(e.target.value)} /></label><button className="absence-primary" disabled={busy}>ورود</button></form>{error && <p className="absence-alert error">{error}</p>}</section></main>;

  return <main dir="rtl" className="absence-shell">
    <header className="absence-header"><a className="absence-brand" href="/">F-S <span>سامانه مدیریت فرایند</span></a><div className="absence-header-actions"><a className="absence-back" href="/">بازگشت به خانه</a><button className="absence-logout" onClick={() => { localStorage.removeItem('fsb.accessToken'); setToken(''); setLoggedIn(false); }}>خروج</button></div></header>
    <section className="absence-intro"><div><div className="absence-kicker">WORKFLOW / RECOVERY OPERATIONS</div><h1>رخدادهای بازیابی گردش‌کار</h1><p>تشخیص خطا، بررسی تلاش‌های Worker، مشاهده اصلاحات و ثبت تأیید نهایی</p></div><button className="absence-primary" disabled={busy} onClick={() => void load()}>بروزرسانی فهرست</button></section>
    {error && <div className="absence-alert error" role="alert">{error}</div>}{notice && <div className="absence-alert success" role="status">{notice}</div>}
    <section className="absence-panel">
      <div className="absence-panel-heading"><div><h2>فیلتر رخدادها</h2><p>فهرست به‌صورت پیش‌فرض رخدادهای باز و در حال رسیدگی را نشان می‌دهد.</p></div><span className="absence-step">{items.length.toLocaleString('fa-IR')} رخداد</span></div>
      <div className="absence-toolbar" style={{ flexWrap: 'wrap' }}>
        <select aria-label="سازمان" value={organizationId} onChange={e => setOrganizationId(e.target.value)}><option value="">همه سازمان‌های قابل دسترس</option>{organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <input aria-label="شناسه فرایند" placeholder="شناسه فرایند" value={processInstanceId} onChange={e => setProcessInstanceId(e.target.value)} style={{ minWidth: 220, border: "1px solid #dce2ec", borderRadius: 9, padding: 11, font: "inherit" }} />
        <select aria-label="نوع رخداد" value={incidentType} onChange={e => setIncidentType(e.target.value)}><option value="">همه انواع رخداد</option><option value="RUNNING_PROCESS_TASK_COUNT_MISMATCH">ناهماهنگی تعداد وظایف</option><option value="TERMINAL_PROCESS_HAS_ACTIVE_TASKS">وظیفه فعال در فرایند خاتمه‌یافته</option></select>
        <select aria-label="شدت" value={severity} onChange={e => setSeverity(e.target.value)}><option value="">همه شدت‌ها</option><option value="CRITICAL">بحرانی</option><option value="HIGH">زیاد</option><option value="MEDIUM">متوسط</option></select>
        <select aria-label="وضعیت" value={status} onChange={e => setStatus(e.target.value)}><option value="ACTIVE">باز و در حال رسیدگی</option><option value="OPEN">فقط باز</option><option value="ACKNOWLEDGED">در حال رسیدگی</option><option value="RESOLVED">بسته‌شده</option></select>
      </div>
    </section>
    <section className="absence-panel"><div className="absence-table-wrap"><table className="absence-table" style={{ minWidth: 900 }}><thead><tr>{['شدت','نوع رخداد','سازمان / فرایند','وضعیت فرایند','وضعیت رسیدگی','تعداد رویدادها','زمان ثبت','جزئیات'].map(x => <th key={x}>{x}</th>)}</tr></thead><tbody>
      {items.map(item => <tr key={item.id}><td><span className={'absence-pill ' + (item.severity === 'CRITICAL' ? 'cancelled' : item.severity === 'HIGH' ? 'upcoming' : 'active')}>{severityLabel(item.severity)}</span></td><td>{typeLabel(item.incidentType)}</td><td><strong>{item.organizationName}</strong><small>{item.processTitle || item.processInstanceId}</small></td><td>{item.processStatus}</td><td>{statusLabel(item.status)}</td><td>{Number(item.eventCount || 0).toLocaleString('fa-IR')}</td><td>{faDate(item.createdAt)}</td><td><button className="absence-secondary" onClick={() => void openDetail(item.id)}>بررسی</button></td></tr>)}
      {items.length === 0 && <tr><td colSpan={8}><div className="absence-empty"><strong>رخدادی پیدا نشد</strong><span>فیلترها را تغییر دهید یا فهرست را تازه‌سازی کنید.</span></div></td></tr>}
    </tbody></table></div></section>
    {detail && <section className="absence-panel">
      <div className="absence-panel-heading"><div><h2>جزئیات رخداد</h2><p>{typeLabel(detail.incident.incidentType)} · {detail.incident.organizationName} · {detail.incident.processTitle || detail.incident.processInstanceId}</p></div><button className="absence-secondary" onClick={() => setDetail(null)}>بستن جزئیات</button></div>
      <div className="absence-summary" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}><article><span>شدت</span><strong>{severityLabel(detail.incident.severity)}</strong></article><article><span>وضعیت رسیدگی</span><strong>{statusLabel(detail.incident.status)}</strong></article><article><span>زمان ایجاد</span><strong style={{ fontSize: 13 }}>{faDate(detail.incident.createdAt)}</strong></article><article><span>آخرین تغییر</span><strong style={{ fontSize: 13 }}>{faDate(detail.incident.updatedAt)}</strong></article></div>
      <h3>شرح تشخیص Worker</h3><pre style={{ direction: 'ltr', textAlign: 'left', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#f7f8fb', padding: 14, borderRadius: 9, fontSize: 11 }}>{JSON.stringify(detail.incident.details, null, 2)}</pre>
      <h3>تاریخچه تلاش‌های Worker و اقدامات مدیریتی</h3><div className="absence-table-wrap"><table className="absence-table"><thead><tr><th>نوع رویداد</th><th>عامل</th><th>جزئیات</th><th>زمان</th></tr></thead><tbody>{detail.events.map(event => <tr key={event.id}><td>{event.eventType}</td><td>{event.actorUserId || 'Worker / System'}</td><td style={{ maxWidth: 430, whiteSpace: 'normal' }}>{JSON.stringify(event.metadata)}</td><td>{faDate(event.createdAt)}</td></tr>)}{detail.events.length === 0 && <tr><td colSpan={4}>هنوز رویدادی ثبت نشده است.</td></tr>}</tbody></table></div>
      <h3 style={{ marginTop: 24 }}>اقدامات اصلاحی مرتبط با وظایف</h3><div className="absence-table-wrap"><table className="absence-table"><thead><tr><th>شناسه وظیفه</th><th>نوع اقدام</th><th>جزئیات</th><th>زمان</th></tr></thead><tbody>{detail.lifecycle.map(event => <tr key={event.id}><td>{event.taskId}</td><td>{event.eventType}</td><td style={{ maxWidth: 430, whiteSpace: 'normal' }}>{JSON.stringify(event.details)}</td><td>{faDate(event.createdAt)}</td></tr>)}{detail.lifecycle.length === 0 && <tr><td colSpan={4}>اقدام اصلاحی مرتبطی ثبت نشده است.</td></tr>}</tbody></table></div>
      <div className="absence-form" style={{ marginTop: 22 }}><label>یادداشت رسیدگی / توضیح اصلاح<textarea rows={3} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="شرح بررسی و اقدام اصلاحی را ثبت کنید..." /></label><div className="absence-form-actions">
        {detail.incident.status === 'OPEN' && <button className="absence-primary" disabled={busy} onClick={() => void act('acknowledge')}>تأیید شروع رسیدگی</button>}
        {detail.incident.status === 'ACKNOWLEDGED' && <button className="absence-primary" disabled={busy || note.trim().length < 5} onClick={() => void act('resolve')}>بستن رخداد با ثبت توضیح</button>}
        <button className="absence-secondary" disabled={busy} onClick={() => void act('replay')}>درخواست Replay کنترل‌شده</button>
      </div></div>
      <p className="absence-form-note">Replay فعلاً برای این دو نوع رخداد فعال نیست؛ چون هیچ Handler مستقل و اثبات‌شدهٔ Idempotent برای اجرای مجدد آن‌ها تعریف نشده است. اقدام انسانی، انتخاب مرحله و پیشبرد حدسی فرایند هرگز Replay نمی‌شود. درخواست ردشده نیز در تاریخچه و Audit ثبت خواهد شد.</p>
    </section>}
    <footer className="absence-footer"><span>F-S · مدیریت رخدادهای موتور گردش‌کار</span><span>Tenant-scoped · Audited · No unsafe replay</span></footer>
  </main>;
}
