"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

type Organization = { id: string; name: string; code: string };
type User = { id: string; firstName: string; lastName: string; username: string; email: string };
type Workload = { userId: string; openTaskCount: number; substitutionCoverageCount: number; delegatedTaskCount: number };
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
  const [tenantId, setTenantId] = useState('');
  const [password, setPassword] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [workload, setWorkload] = useState<Workload[]>([]);
  const [policy, setPolicy] = useState({ configured: false, maxOpenTasksPerSubstitute: 10, warningThresholdPercent: 80, enforceLimit: false });
  const [policySaving, setPolicySaving] = useState(false);
  const [workloadLoading, setWorkloadLoading] = useState(false);
  const [workloadAsOf, setWorkloadAsOf] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [items, setItems] = useState<Absence[]>([]);
  const [calendarItems, setCalendarItems] = useState<Absence[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ total: 0, active: 0, upcoming: 0, expired: 0, cancelled: 0 });
  const [pageOffset, setPageOffset] = useState(0);
  const pageSize = 25;
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarTruncated, setCalendarTruncated] = useState(false);
  const [conflictItems, setConflictItems] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [showForm, setShowForm] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [form, setForm] = useState({
    userId: '', substituteUserId: '',
    startsAt: localDateTime(new Date(Date.now() + 60000)),
    endsAt: localDateTime(new Date(Date.now() + 86400000)),
    reason: '',
  });

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}), ...(init.headers || {}) },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.message;
      throw new Error(Array.isArray(message) ? message.join('، ') : message || `خطای سرور (${response.status})`);
    }
    return payload;
  }, [token, tenantId]);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError('');
    try {
      const orgs = await request('/organizations/accessible');
      setOrganizations(orgs);
      const selectedOrg = organizationId && orgs.some((org: Organization) => org.id === organizationId)
        ? organizationId : orgs[0]?.id || '';
      if (selectedOrg !== organizationId) {
        setOrganizationId(selectedOrg); setPageOffset(0);
        setUsers([]); setItems([]); setTotal(0);
      }
      if (selectedOrg) {
        const [people, result, workloadResult] = await Promise.all([
          request(`/organizations/${selectedOrg}/users`),
          request(`/organizations/${selectedOrg}/absences?limit=${pageSize}&offset=${pageOffset}&status=${filter}`),
          request(`/organizations/${selectedOrg}/workload`),
        ]);
        setUsers(people); setWorkload(workloadResult.items || []); setPolicy(workloadResult.policy || { configured: false, maxOpenTasksPerSubstitute: 10, warningThresholdPercent: 80, enforceLimit: false }); setItems(result.items || []); setTotal(result.total || 0);
        setSummary(result.summary || { total: result.total || 0, active: 0, upcoming: 0, expired: 0, cancelled: 0 });
      } else {
        setUsers([]); setWorkload([]); setPolicy({ configured: false, maxOpenTasksPerSubstitute: 10, warningThresholdPercent: 80, enforceLimit: false }); setItems([]); setCalendarItems([]); setTotal(0);
        setSummary({ total: 0, active: 0, upcoming: 0, expired: 0, cancelled: 0 });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'دریافت اطلاعات ناموفق بود');
    } finally { setLoading(false); }
  }, [token, request, organizationId, pageOffset, filter]);

  const loadCalendar = useCallback(async () => {
    if (!token || !organizationId) {
      setCalendarItems([]); setCalendarTruncated(false); return;
    }
    setCalendarLoading(true); setCalendarTruncated(false);
    try {
      const from = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1).toISOString();
      const to = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1).toISOString();
      const monthRows: Absence[] = [];
      let monthOffset = 0;
      let monthTotal = 0;
      do {
        const monthResult = await request(`/organizations/${organizationId}/absences?limit=100&offset=${monthOffset}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&status=ALL`);
        monthRows.push(...(monthResult.items || []));
        monthTotal = Number(monthResult.total || 0);
        monthOffset += 100;
      } while (monthOffset < monthTotal && monthOffset < 10000);
      setCalendarItems(monthRows);
      setCalendarTruncated(monthOffset < monthTotal);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'دریافت تقویم ناموفق بود');
      setCalendarItems([]);
    } finally { setCalendarLoading(false); }
  }, [token, organizationId, calendarMonth, request]);

  useEffect(() => {
    const saved = window.localStorage.getItem('fsb.accessToken');
    const savedTenant = window.localStorage.getItem('fsb.tenantId') || '';
    setTenantId(savedTenant);
    if (saved) { setToken(saved); setLoggedIn(true); }
  }, []);

  useEffect(() => { if (loggedIn && token) void loadData(); }, [loggedIn, token, loadData]);
  useEffect(() => { if (loggedIn && token) void loadCalendar(); }, [loggedIn, token, loadCalendar]);
  useEffect(() => {
    if (!loggedIn || !token || !organizationId) { setWorkload([]); setWorkloadAsOf(''); return; }
    const start = new Date(form.startsAt);
    if (!Number.isFinite(start.getTime())) return;
    let cancelled = false;
    setWorkloadLoading(true);
    request(`/organizations/${organizationId}/workload?at=${encodeURIComponent(start.toISOString())}${form.userId ? `&absentUserId=${encodeURIComponent(form.userId)}` : ''}${form.userId && form.substituteUserId ? `&substituteUserId=${encodeURIComponent(form.substituteUserId)}` : ''}`)
      .then(result => {
        if (cancelled) return;
        setWorkload(result.items || []);
        setPolicy(result.policy || { configured: false, maxOpenTasksPerSubstitute: 10, warningThresholdPercent: 80, enforceLimit: false });
        setWorkloadAsOf(result.asOf || start.toISOString());
      })
      .catch(error => { if (!cancelled) setError(error instanceof Error ? error.message : 'محاسبه بار کاری در زمان شروع ناموفق بود'); })
      .finally(() => { if (!cancelled) setWorkloadLoading(false); });
    return () => { cancelled = true; };
  }, [loggedIn, token, organizationId, form.startsAt, form.userId, form.substituteUserId, request]);

  const userMap = useMemo(() => new Map(users.map(user => [user.id, user])), [users]);
  useEffect(() => {
    if (!token || !organizationId) { setConflictItems([]); return; }
    const fromDate = new Date(form.startsAt);
    const toDate = new Date(form.endsAt);
    if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime()) ||
        toDate <= fromDate || toDate.getTime() - fromDate.getTime() > 93 * 24 * 60 * 60 * 1000) {
      setConflictItems([]);
      return;
    }
    let cancelled = false;
    const loadConflicts = async () => {
      try {
        const rows: Absence[] = [];
        let offset = 0;
        let totalRows = 0;
        do {
          const result = await request(`/organizations/${organizationId}/absences?limit=100&offset=${offset}&from=${encodeURIComponent(fromDate.toISOString())}&to=${encodeURIComponent(toDate.toISOString())}&status=ALL`);
          rows.push(...(result.items || []));
          totalRows = Number(result.total || 0);
          offset += 100;
        } while (offset < totalRows && offset < 10000);
        if (!cancelled) setConflictItems(rows);
      } catch {
        if (!cancelled) setConflictItems([]);
      }
    };
    void loadConflicts();
    return () => { cancelled = true; };
  }, [token, organizationId, form.startsAt, form.endsAt, request]);

  const conflicts = useMemo(() => {
    const start = new Date(form.startsAt).getTime(), end = new Date(form.endsAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return conflictItems.filter(item => {
      if (item.cancelledAt) return false;
      const overlaps = start < new Date(item.endsAt).getTime() && end > new Date(item.startsAt).getTime();
      return overlaps && (item.userId === form.userId || item.substituteUserId === form.substituteUserId ||
        item.userId === form.substituteUserId || item.substituteUserId === form.userId);
    });
  }, [conflictItems, form]);
  const calendarCells = useMemo(() => {
    const first = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const offset = (first.getDay() + 1) % 7;
    const count = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
    return [...Array(offset).fill(null), ...Array.from({ length: count }, (_, index) => new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), index + 1))];
  }, [calendarMonth]);
  const calendarLabel = calendarMonth.toLocaleDateString('fa-IR', { month: 'long', year: 'numeric' });
  const dayItems = (day: Date) => calendarItems.filter(item => !item.cancelledAt &&
    new Date(item.startsAt).getTime() < new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime() &&
    new Date(item.endsAt).getTime() > new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime());

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
      if (tenantId.trim()) window.localStorage.setItem('fsb.tenantId', tenantId.trim());
      else window.localStorage.removeItem('fsb.tenantId');
      setToken(result.accessToken); setLoggedIn(true); setPassword(''); setNotice('ورود با موفقیت انجام شد');
    } catch (e) { setError(e instanceof Error ? e.message : 'ورود ناموفق بود'); }
    finally { setLoading(false); }
  }

  async function saveWorkloadPolicy(event: FormEvent) {
    event.preventDefault(); setPolicySaving(true); setError(''); setNotice('');
    try {
      const result = await request(`/organizations/${organizationId}/workload-policy`, {
        method: 'POST',
        body: JSON.stringify({
          maxOpenTasksPerSubstitute: policy.maxOpenTasksPerSubstitute,
          warningThresholdPercent: policy.warningThresholdPercent,
          enforceLimit: policy.enforceLimit,
        }),
      });
      setPolicy(result.policy);
      setNotice('سیاست ظرفیت بار کاری سازمان ذخیره شد');
      await loadData();
    } catch (e) { setError(e instanceof Error ? e.message : 'ذخیره سیاست ظرفیت ناموفق بود'); }
    finally { setPolicySaving(false); }
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
      await Promise.all([loadData(), loadCalendar()]);
    } catch (e) { setError(e instanceof Error ? e.message : 'ثبت غیبت ناموفق بود'); }
    finally { setSaving(false); }
  }

  async function cancelAbsence(item: Absence) {
    if (!window.confirm('این غیبت لغو شود؟ دسترسی جانشین نیز بلافاصله لغو خواهد شد.')) return;
    setError(''); setNotice('');
    try {
      await request(`/organizations/${organizationId}/absences/${item.id}`, { method: 'DELETE' });
      setNotice('غیبت لغو شد و سابقهٔ آن حفظ گردید');
      await Promise.all([loadData(), loadCalendar()]);
    } catch (e) { setError(e instanceof Error ? e.message : 'لغو غیبت ناموفق بود'); }
  }

  function logout() {
    window.localStorage.removeItem('fsb.accessToken'); window.localStorage.removeItem('fsb.tenantId'); setToken(''); setTenantId(''); setLoggedIn(false);
    setOrganizations([]); setUsers([]); setWorkload([]); setItems([]);
  }

  const selectedSubstituteLoad = workload.find(row => row.userId === form.substituteUserId);
  const selectedSubstituteAtLimit = Boolean(policy.enforceLimit && selectedSubstituteLoad && selectedSubstituteLoad.openTaskCount >= policy.maxOpenTasksPerSubstitute);

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
        <p>برای دسترسی به اطلاعات سازمانی، با حساب کاربری دارای مجوز مدیریت جانشینی وارد شوید. اگر عضو چند مشتری هستید، شناسهٔ مشتری فعال را نیز وارد کنید.</p>
        <form onSubmit={login} className="absence-form">
          <label>نام کاربری یا ایمیل<input value={identity} onChange={e => setIdentity(e.target.value)} required autoComplete="username" /></label>
          <label>گذرواژه<input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></label>
          <label>شناسه مشتری (در صورت عضویت در چند مشتری)<input value={tenantId} onChange={e => setTenantId(e.target.value)} placeholder="UUID مشتری؛ برای عضویت تکی خالی بماند" /></label>
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
          <label>سازمان<select required value={organizationId} onChange={e => { setOrganizationId(e.target.value); setPageOffset(0); }}><option value="">انتخاب سازمان</option>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
          <label>کارمند غایب<select required value={form.userId} onChange={e => setForm(v => ({ ...v, userId: e.target.value }))}><option value="">انتخاب کارمند</option>{users.map(user => <option key={user.id} value={user.id}>{personName(user)} · {user.username}</option>)}</select></label>
          <label>جانشین موقت<select required value={form.substituteUserId} onChange={e => setForm(v => ({ ...v, substituteUserId: e.target.value }))}><option value="">انتخاب جانشین</option>{users.filter(user => user.id !== form.userId).map(user => { const load = workload.find(row => row.userId === user.id); return <option key={user.id} value={user.id}>{personName(user)} · {user.username} · {load?.openTaskCount ?? 0} وظیفه باز · {load && policy.configured && load.openTaskCount >= policy.maxOpenTasksPerSubstitute * policy.warningThresholdPercent / 100 ? 'هشدار ظرفیت' : 'ظرفیت عادی'}</option>; })}</select></label>
          <label>شروع غیبت<input type="datetime-local" required value={form.startsAt} onChange={e => setForm(v => ({ ...v, startsAt: e.target.value }))} /></label>
          <label>پایان غیبت<input type="datetime-local" required min={form.startsAt} value={form.endsAt} onChange={e => setForm(v => ({ ...v, endsAt: e.target.value }))} /></label>
          <label className="absence-full">علت / توضیحات<textarea required minLength={5} maxLength={1000} rows={3} value={form.reason} onChange={e => setForm(v => ({ ...v, reason: e.target.value }))} placeholder="علت غیبت یا توضیح لازم برای ثبت در سوابق…" /></label>
          {selectedSubstituteAtLimit && <div className="absence-conflict absence-full"><strong>ظرفیت جانشین تکمیل است</strong><span>این جانشین {selectedSubstituteLoad?.openTaskCount ?? 0} وظیفه باز دارد و سقف سازمان {policy.maxOpenTasksPerSubstitute} است. با فعال بودن محدودیت ظرفیت، ثبت در سمت سرور نیز رد خواهد شد.</span></div>}
          <div className="absence-form-note absence-full">بار کاری جانشین بر اساس وظایف باز مستقیم و وظایف تحت پوشش جانشینی فعال محاسبه می‌شود. تعداد وظایف باز و پیش‌بینی پوشش کارمند غایب برای جانشین انتخاب‌شده: {workload.find(row => row.userId === form.substituteUserId)?.openTaskCount ?? 0} (از جمله {workload.find(row => row.userId === form.substituteUserId)?.substitutionCoverageCount ?? 0} جانشینی و {workload.find(row => row.userId === form.substituteUserId)?.delegatedTaskCount ?? 0} واگذاری). هر دو نفر باید عضو فعال همین مشتری و دارای پست معتبر در سازمان انتخاب‌شده باشند. حداکثر مدت هر غیبت ۹۰ روز است.</div>
          {conflicts.length > 0 && <div className="absence-conflict absence-full"><strong>تداخل زمانی شناسایی شد</strong><span>این بازه با {conflicts.length.toLocaleString('fa-IR')} سابقهٔ فعال تداخل دارد. اگر فرد غایب از قبل جانشینی هم‌پوشان داشته باشد، ثبت توسط سرور رد می‌شود؛ حضور جانشین در چند جانشینی هم‌زمان نیز نیازمند بررسی مدیریتی است.</span></div>}
          <div className="absence-form-actions absence-full"><button type="button" className="absence-secondary" onClick={() => setShowForm(false)}>انصراف</button><button className="absence-primary" disabled={saving || workloadLoading || !organizationId || form.userId === form.substituteUserId || conflicts.some(item => item.userId === form.userId) || selectedSubstituteAtLimit}>{saving ? 'در حال ثبت…' : 'ثبت غیبت و جانشین'}</button></div>
        </form>
      </section>}

      <section className="absence-panel" style={{ marginTop: 22 }}>
        <div className="absence-panel-heading"><div><h2>سیاست ظرفیت جانشینان</h2><p>ظرفیت بر اساس زمان شروع جانشینی محاسبه می‌شود؛ وظایف باز فعلی به‌عنوان بار کاری باقی‌مانده در آن زمان برآورد می‌شوند.</p></div>
          <span className={policy.enforceLimit ? 'absence-pill active' : 'absence-pill upcoming'}>{policy.enforceLimit ? 'محدودیت فعال' : 'صرفاً هشدار / غیرفعال'}</span>
        </div>
        <form className="absence-form" onSubmit={saveWorkloadPolicy}>
          <label>حداکثر وظیفه باز برای هر جانشین<input type="number" min="1" max="500" required value={policy.maxOpenTasksPerSubstitute} onChange={e => setPolicy(v => ({ ...v, configured: true, maxOpenTasksPerSubstitute: Number(e.target.value) }))} /></label>
          <label>آستانه هشدار ظرفیت (%)<input type="number" min="1" max="100" required value={policy.warningThresholdPercent} onChange={e => setPolicy(v => ({ ...v, configured: true, warningThresholdPercent: Number(e.target.value) }))} /></label>
          <label className="absence-inline-check"><input type="checkbox" checked={policy.enforceLimit} onChange={e => setPolicy(v => ({ ...v, configured: true, enforceLimit: e.target.checked }))} /> جلوگیری از ثبت جانشینی در صورت تکمیل ظرفیت</label>
          <div className="absence-form-actions absence-full"><button className="absence-primary" disabled={policySaving || !organizationId}>{policySaving ? 'در حال ذخیره…' : 'ذخیره سیاست ظرفیت'}</button></div>
        </form>
        <div className="absence-workload-list">
          <div className="absence-form-note">{workloadLoading ? 'در حال محاسبه بار کاری برای زمان شروع انتخاب‌شده…' : workloadAsOf ? `زمان مبنای برآورد: ${new Date(workloadAsOf).toLocaleString('fa-IR')}` : 'زمان مبنای برآورد مشخص نیست'}</div>
          {workload.slice(0, 8).map(person => {
            const percent = Math.round(person.openTaskCount / Math.max(1, policy.maxOpenTasksPerSubstitute) * 100);
            const warning = policy.configured && percent >= policy.warningThresholdPercent;
            return <div className="absence-workload-row" key={person.userId}>
              <span>{personName(users.find(u => u.id === person.userId))}</span>
              <span>{person.openTaskCount.toLocaleString('fa-IR')} / {policy.maxOpenTasksPerSubstitute.toLocaleString('fa-IR')} وظیفه</span>
              <div className="absence-workload-track"><i style={{ width: `${Math.min(100, percent)}%` }} /></div>
              <small>{person.substitutionCoverageCount.toLocaleString('fa-IR')} جانشینی · {person.delegatedTaskCount.toLocaleString('fa-IR')} واگذاری · {warning ? 'نیازمند توجه' : 'ظرفیت مناسب'}</small>
            </div>;
          })}
        </div>
      </section>

      <section className="absence-summary">
        <article><span>کل سوابق</span><strong>{summary.total.toLocaleString('fa-IR')}</strong></article>
        <article><span>در حال اجرا</span><strong>{summary.active.toLocaleString('fa-IR')}</strong></article>
        <article><span>برنامه‌ریزی‌شده</span><strong>{summary.upcoming.toLocaleString('fa-IR')}</strong></article>
        <article><span>لغوشده</span><strong>{summary.cancelled.toLocaleString('fa-IR')}</strong></article>
      </section>

      <section className="absence-panel absence-calendar-panel">
        <div className="absence-panel-heading"><div><h2>تقویم غیبت و جانشینی</h2><p>نمای روزانهٔ غیبت‌های ثبت‌شده در سازمان انتخاب‌شده{calendarLoading ? ' · در حال بارگذاری…' : ''}</p></div>
          <div className="absence-calendar-nav"><button className="absence-secondary" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}>ماه قبل</button><strong>{calendarLabel}</strong><button className="absence-secondary" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}>ماه بعد</button></div>
        </div>
        {calendarTruncated && <div className="absence-alert error">به‌دلیل حجم بالای داده، تقویم حداکثر ۱۰٬۰۰۰ رکورد این ماه را نمایش می‌دهد؛ برای گزارش کامل از فیلتر و صفحه‌بندی دفتر سوابق استفاده کنید.</div>}
        <div className="absence-calendar-grid">
          {['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'].map(day => <div className="absence-calendar-weekday" key={day}>{day}</div>)}
          {calendarCells.map((day, index) => day ? <div className={day.getMonth() === calendarMonth.getMonth() ? 'absence-calendar-day' : 'absence-calendar-day outside'} key={day.toISOString()}>
            <span className="absence-calendar-number">{day.getDate().toLocaleString('fa-IR')}</span>
            {dayItems(day).slice(0, 2).map(item => <span className="absence-calendar-event" key={item.id} title={`${personName(userMap.get(item.userId))} ← ${personName(userMap.get(item.substituteUserId))}`}>{personName(userMap.get(item.userId))}</span>)}
            {dayItems(day).length > 2 && <small>+{(dayItems(day).length - 2).toLocaleString('fa-IR')} مورد دیگر</small>}
          </div> : <div className="absence-calendar-day empty" key={`blank-${index}`} />)}
        </div>
      </section>

      <section className="absence-panel">
        <div className="absence-panel-heading"><div><h2>دفتر ثبت غیبت‌ها</h2><p>سوابق غیبت و جانشینی در محدودهٔ سازمان انتخاب‌شده</p></div>
          <div className="absence-toolbar"><select aria-label="سازمان" value={organizationId} onChange={e => { setOrganizationId(e.target.value); setPageOffset(0); }}><option value="">انتخاب سازمان</option>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select><button className="absence-secondary" onClick={() => void loadData()}>به‌روزرسانی</button></div>
        </div>
        <div className="absence-filters">
          {[['ALL','همه'],['ACTIVE','در حال اجرا'],['UPCOMING','آینده'],['EXPIRED','پایان‌یافته'],['CANCELLED','لغوشده']].map(([key,label]) => <button key={key} className={filter === key ? 'selected' : ''} onClick={() => { setFilter(key); setPageOffset(0); }}>{label}</button>)}
        </div>
        {loading ? <div className="absence-empty">در حال دریافت اطلاعات…</div> : !organizationId ? <div className="absence-empty">برای مشاهدهٔ سوابق، ابتدا یکی از سازمان‌هایی را که به آن دسترسی دارید انتخاب کنید.</div> : visibleItems.length === 0 ? <div className="absence-empty"><strong>موردی برای نمایش وجود ندارد</strong><span>با تغییر فیلتر یا ثبت غیبت جدید، سوابق در این قسمت نمایش داده می‌شوند.</span></div> :
          <div className="absence-table-wrap"><table className="absence-table"><thead><tr><th>کارمند غایب</th><th>جانشین</th><th>بازهٔ غیبت</th><th>علت</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>
            {visibleItems.map(item => { const status = statusOf(item); return <tr key={item.id}>
              <td><strong>{personName(userMap.get(item.userId))}</strong><small>{userMap.get(item.userId)?.username || '—'}</small></td>
              <td><strong>{personName(userMap.get(item.substituteUserId))}</strong><small>{userMap.get(item.substituteUserId)?.username || '—'}</small></td>
              <td><span>{new Date(item.startsAt).toLocaleString('fa-IR')}</span><small>تا {new Date(item.endsAt).toLocaleString('fa-IR')}</small></td>
              <td className="absence-reason">{item.reason}</td><td><span className={status.cls}>{status.label}</span></td>
              <td>{!item.cancelledAt && new Date(item.endsAt).getTime() > Date.now() ? <button className="absence-cancel" onClick={() => void cancelAbsence(item)}>لغو غیبت</button> : <span className="absence-muted">—</span>}</td>
            </tr>; })}
          </tbody></table></div>}
        {!loading && organizationId && <div className="absence-pagination">
          <span>نمایش {(total === 0 ? 0 : pageOffset + 1).toLocaleString('fa-IR')} تا {Math.min(pageOffset + pageSize, total).toLocaleString('fa-IR')} از {total.toLocaleString('fa-IR')} مورد</span>
          <div><button className="absence-secondary" disabled={pageOffset === 0 || loading} onClick={() => setPageOffset(Math.max(0, pageOffset - pageSize))}>صفحهٔ قبل</button>
          <button className="absence-secondary" disabled={pageOffset + pageSize >= total || loading} onClick={() => setPageOffset(pageOffset + pageSize)}>صفحهٔ بعد</button></div>
        </div>}
      </section>
      <footer className="absence-footer"><span>F-S · مدیریت منابع انسانی و تداوم گردش کار</span><span>اطلاعات بر اساس محدودهٔ مشتری احراز هویت‌شده</span></footer>
    </main>
  );
}
