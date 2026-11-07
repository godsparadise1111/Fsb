"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

type Organization = { id: string; name: string; code: string };
type User = { id: string; firstName: string; lastName: string; username: string; email: string };
type Absence = {
  id: string; organizationId: string; userId: string; substituteUserId: string;
  startsAt: string; endsAt: string; reason: string; createdAt: string;
  cancelledAt: string | null;
};
const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api').replace(/\/$/, '');
const localDateTime = (value: Date) => {
  const offset = value.getTimezoneOffset();
  return new Date(value.getTime() - offset * 60000).toISOString().slice(0, 16);
};
const personName = (user?: User) => user ? `${user.firstName} ${user.lastName}` : 'کاربر نامشخص';

export default function AbsencesPage() {
  const [token, setToken] = useState('');
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [items, setItems] = useState<Absence[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    userId: '', substituteUserId: '',
    startsAt: localDateTime(new Date(Date.now() + 60000)),
    endsAt: localDateTime(new Date(Date.now() + 86400000)),
    reason: '',
  });

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.message;
      throw new Error(Array.isArray(message) ? message.join('، ') : message || `خطای سرور (${response.status})`);
    }
    return payload;
  }, [token]);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError('');
    try {
      const [orgs, people] = await Promise.all([request('/organizations'), request('/users')]);
      setOrganizations(orgs);
      setUsers(people);
      const selectedOrg = organizationId && orgs.some((org: Organization) => org.id === organizationId)
        ? organizationId : orgs[0]?.id || '';
      setOrganizationId(selectedOrg);
      if (selectedOrg) {
        const result = await request(`/organizations/${selectedOrg}/absences?limit=100&offset=0`);
        setItems(result.items || []); setTotal(result.total || 0);
      } else { setItems([]); setTotal(0); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'دریافت اطلاعات ناموفق بود');
    } finally { setLoading(false); }
  }, [token, request, organizationId]);

  useEffect(() => {
    const saved = window.localStorage.getItem('fsb.accessToken');
    if (saved) { setToken(saved); setLoggedIn(true); }
  }, []);

  useEffect(() => { if (loggedIn && token) void loadData(); }, [loggedIn, token, loadData]);

  const userMap = useMemo(() => new Map(users.map(user => [user.id, user])), [users]);
  const visibleItems = useMemo(() => items.filter(item => {
    if (filter === 'CANCELLED') return Boolean(item.cancelledAt);
    if (item.cancelledAt) return false;
    const now = Date.now(), start = new Date(item.startsAt).getTime(), end = new Date(item.endsAt).getTime();
    if (filter === 'ACTIVE') return start <= now && end > now;
    if (filter === 'UPCOMING') return start > now;
    if (filter === 'EXPIRED') return end <= now;
    return true;
  }), [items, filter]);

  async function login(event: FormEvent) {
    event.preventDefault(); setError(''); setLoading(true);
    try {
      const response = await fetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: identity, password }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.message || 'نام کاربری یا گذرواژه صحیح نیست');
      window.localStorage.setItem('fsb.accessToken', result.accessToken);
      setToken(result.accessToken); setLoggedIn(true); setPassword(''); setNotice('ورود با موفقیت انجام شد');
    } catch (e) { setError(e instanceof Error ? e.message : 'ورود ناموفق بود'); }
    finally { setLoading(false); }
  }

  async function createAbsence(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      await request('/organization-absences', {
        method: 'POST',
        body: JSON.stringify({ organizationId, ...form, startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString() }),
      });
      setNotice('غیبت و جانشینی با موفقیت ثبت شد');
      setShowForm(false);
      setForm(current => ({ ...current, reason: '' }));
      await loadData();
    } catch (e) { setError(e instanceof Error ? e.message : 'ثبت غیبت ناموفق بود'); }
    finally { setSaving(false); }
  }

  async function cancelAbsence(item: Absence) {
    if (!window.confirm('این غیبت لغو شود؟ دسترسی جانشین نیز بلافاصله لغو خواهد شد.')) return;
    setError(''); setNotice('');
    try {
      await request(`/organizations/${organizationId}/absences/${item.id}`, { method: 'DELETE' });
      setNotice('غیبت لغو شد و سابقهٔ آن حفظ گردید');
      await loadData();
    } catch (e) { setError(e instanceof Error ? e.message : 'لغو غیبت ناموفق بود'); }
  }

  function logout() {
    window.localStorage.removeItem('fsb.accessToken'); setToken(''); setLoggedIn(false);
    setOrganizations([]); setUsers([]); setItems([]);
  }

  const statusOf = (item: Absence) => {
    if (item.cancelledAt) return { label: 'لغوشده', cls: 'absence-pill cancelled' };
    const now = Date.now(), start = new Date(item.startsAt).getTime(), end = new Date(item.endsAt).getTime();
    if (start > now) return { label: 'در انتظار شروع', cls: 'absence-pill upcoming' };
    if (end <= now) return { label: 'پایان‌یافته', cls: 'absence-pill expired' };
    return { label: 'در حال اجرا', cls: 'absence-pill active' };
  };

  if (!loggedIn) return (
    <main className="absence-shell" dir="rtl">
      <header className="absence-header"><a className="absence-brand" href="/">F-S <span>مدیریت فرایندهای سازمانی</span></a><a className="absence-back" href="/">بازگشت به خانه</a></header>
      <section className="absence-login">
        <div className="absence-kicker">WORKFORCE MANAGEMENT</div>
        <h1>ورود به مدیریت غیبت و جانشینی</h1>
        <p>برای دسترسی به اطلاعات سازمانی، با حساب کاربری دارای مجوز مدیریت جانشینی وارد شوید.</p>
        <form onSubmit={login} className="absence-form">
          <label>نام کاربری یا ایمیل<input value={identity} onChange={e => setIdentity(e.target.value)} required autoComplete="username" /></label>
          <label>گذرواژه<input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></label>
          {error && <div className="absence-alert error">{error}</div>}
          <button className="absence-primary" disabled={loading}>{loading ? 'در حال ورود…' : 'ورود امن'}</button>
        </form>
      </section>
    </main>
  );

  return (
    <main className="absence-shell" dir="rtl">
      <header className="absence-header">
        <a className="absence-brand" href="/">F-S <span>مدیریت فرایندهای سازمانی</span></a>
        <div className="absence-header-actions"><a className="absence-back" href="/">صفحهٔ اصلی</a><button className="absence-logout" onClick={logout}>خروج</button></div>
      </header>
      <section className="absence-intro">
        <div><div className="absence-kicker">HUMAN RESOURCES · WORKFLOW CONTINUITY</div><h1>مدیریت غیبت و جانشینی</h1><p>ثبت غیبت کارکنان و تعیین جانشین موقت برای حفظ پیوستگی گردش کار سازمان.</p></div>
        <button className="absence-primary" onClick={() => setShowForm(value => !value)}>{showForm ? 'بستن فرم' : '+ ثبت غیبت جدید'}</button>
      </section>

      {error && <div className="absence-alert error">{error}</div>}
      {notice && <div className="absence-alert success">{notice}</div>}

      {showForm && <section className="absence-panel">
        <div className="absence-panel-heading"><div><h2>ثبت غیبت جدید</h2><p>ثبت غیبت، جانشینی متناظر را نیز به‌صورت اتمیک ایجاد می‌کند.</p></div><span className="absence-step">۱ / اطلاعات غیبت</span></div>
        <form className="absence-form absence-create-grid" onSubmit={createAbsence}>
          <label>سازمان<select required value={organizationId} onChange={e => setOrganizationId(e.target.value)}><option value="">انتخاب سازمان</option>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
          <label>کارمند غایب<select required value={form.userId} onChange={e => setForm(v => ({ ...v, userId: e.target.value }))}><option value="">انتخاب کارمند</option>{users.map(user => <option key={user.id} value={user.id}>{personName(user)} · {user.username}</option>)}</select></label>
          <label>جانشین موقت<select required value={form.substituteUserId} onChange={e => setForm(v => ({ ...v, substituteUserId: e.target.value }))}><option value="">انتخاب جانشین</option>{users.filter(user => user.id !== form.userId).map(user => <option key={user.id} value={user.id}>{personName(user)} · {user.username}</option>)}</select></label>
          <label>شروع غیبت<input type="datetime-local" required value={form.startsAt} onChange={e => setForm(v => ({ ...v, startsAt: e.target.value }))} /></label>
          <label>پایان غیبت<input type="datetime-local" required min={form.startsAt} value={form.endsAt} onChange={e => setForm(v => ({ ...v, endsAt: e.target.value }))} /></label>
          <label className="absence-full">علت / توضیحات<textarea required minLength={5} maxLength={1000} rows={3} value={form.reason} onChange={e => setForm(v => ({ ...v, reason: e.target.value }))} placeholder="علت غیبت یا توضیح لازم برای ثبت در سوابق…" /></label>
          <div className="absence-form-note absence-full">هر دو نفر باید عضو فعال همین مشتری و دارای پست معتبر در سازمان انتخاب‌شده باشند. حداکثر مدت هر غیبت ۹۰ روز است.</div>
          <div className="absence-form-actions absence-full"><button type="button" className="absence-secondary" onClick={() => setShowForm(false)}>انصراف</button><button className="absence-primary" disabled={saving || !organizationId || form.userId === form.substituteUserId}>{saving ? 'در حال ثبت…' : 'ثبت غیبت و جانشین'}</button></div>
        </form>
      </section>}

      <section className="absence-summary">
        <article><span>کل سوابق</span><strong>{total.toLocaleString('fa-IR')}</strong></article>
        <article><span>در حال اجرا</span><strong>{items.filter(item => !item.cancelledAt && new Date(item.startsAt).getTime() <= Date.now() && new Date(item.endsAt).getTime() > Date.now()).length.toLocaleString('fa-IR')}</strong></article>
        <article><span>برنامه‌ریزی‌شده</span><strong>{items.filter(item => !item.cancelledAt && new Date(item.startsAt).getTime() > Date.now()).length.toLocaleString('fa-IR')}</strong></article>
        <article><span>لغوشده</span><strong>{items.filter(item => Boolean(item.cancelledAt)).length.toLocaleString('fa-IR')}</strong></article>
      </section>

      <section className="absence-panel">
        <div className="absence-panel-heading"><div><h2>دفتر ثبت غیبت‌ها</h2><p>سوابق غیبت و جانشینی در محدودهٔ سازمان انتخاب‌شده</p></div>
          <div className="absence-toolbar"><select aria-label="سازمان" value={organizationId} onChange={e => setOrganizationId(e.target.value)}><option value="">انتخاب سازمان</option>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select><button className="absence-secondary" onClick={() => void loadData()}>به‌روزرسانی</button></div>
        </div>
        <div className="absence-filters">
          {[['ALL','همه'],['ACTIVE','در حال اجرا'],['UPCOMING','آینده'],['EXPIRED','پایان‌یافته'],['CANCELLED','لغوشده']].map(([key,label]) => <button key={key} className={filter === key ? 'selected' : ''} onClick={() => setFilter(key)}>{label}</button>)}
        </div>
        {loading ? <div className="absence-empty">در حال دریافت اطلاعات…</div> : !organizationId ? <div className="absence-empty">برای مشاهدهٔ سوابق، ابتدا سازمان فعال انتخاب کنید.</div> : visibleItems.length === 0 ? <div className="absence-empty"><strong>موردی برای نمایش وجود ندارد</strong><span>با تغییر فیلتر یا ثبت غیبت جدید، سوابق در این قسمت نمایش داده می‌شوند.</span></div> :
          <div className="absence-table-wrap"><table className="absence-table"><thead><tr><th>کارمند غایب</th><th>جانشین</th><th>بازهٔ غیبت</th><th>علت</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>
            {visibleItems.map(item => { const status = statusOf(item); return <tr key={item.id}>
              <td><strong>{personName(userMap.get(item.userId))}</strong><small>{userMap.get(item.userId)?.username || '—'}</small></td>
              <td><strong>{personName(userMap.get(item.substituteUserId))}</strong><small>{userMap.get(item.substituteUserId)?.username || '—'}</small></td>
              <td><span>{new Date(item.startsAt).toLocaleString('fa-IR')}</span><small>تا {new Date(item.endsAt).toLocaleString('fa-IR')}</small></td>
              <td className="absence-reason">{item.reason}</td><td><span className={status.cls}>{status.label}</span></td>
              <td>{!item.cancelledAt && new Date(item.endsAt).getTime() > Date.now() ? <button className="absence-cancel" onClick={() => void cancelAbsence(item)}>لغو غیبت</button> : <span className="absence-muted">—</span>}</td>
            </tr>; })}
          </tbody></table></div>}
      </section>
      <footer className="absence-footer"><span>F-S · مدیریت منابع انسانی و تداوم گردش کار</span><span>اطلاعات بر اساس محدودهٔ مشتری احراز هویت‌شده</span></footer>
    </main>
  );
}
