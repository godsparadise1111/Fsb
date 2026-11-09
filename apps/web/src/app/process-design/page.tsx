"use client";

import { useCallback, useEffect, useState, type FormEvent } from 'react';

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api').replace(/\/$/, '');
type ProcessDefinition = { id: string; code: string; name: string; description?: string | null; status: string };
type ProcessVersion = { id: string; versionNumber: number; status: string; schema: Record<string, unknown>; changeNote?: string | null; publishedAt?: string | null };
type OrganizationOption = { id: string; name: string; code?: string };

const exampleSchema = {
  steps: [
    {
      title: 'ثبت و بررسی اولیه',
      instructions: 'اطلاعات درخواست را بررسی کنید.',
      assigneePositionIds: ['11111111-1111-4111-8111-111111111111'],
      assignmentPolicy: 'ALL_ASSIGNEES',
      dueInHours: 24,
    },
    {
      title: 'تأیید مدیر',
      instructions: 'تصمیم نهایی را ثبت کنید.',
      assigneeUnitIds: ['22222222-2222-4222-8222-222222222222'],
      assignmentPolicy: 'ANY_ASSIGNEE',
    },
  ],
  transitions: [
    { fromStepIndex: 0, action: 'APPROVED', toStepIndex: 1 },
    { fromStepIndex: 0, action: 'REJECTED', toStepIndex: null },
    { fromStepIndex: 1, action: 'APPROVED', toStepIndex: null },
    { fromStepIndex: 1, action: 'REJECTED', toStepIndex: 0 },
    { fromStepIndex: 1, action: 'RETURNED', toStepIndex: 0 },
  ],
};

export default function ProcessDesignPage() {
  const [token, setToken] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [definitions, setDefinitions] = useState<ProcessDefinition[]>([]);
  const [versions, setVersions] = useState<ProcessVersion[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [schemaText, setSchemaText] = useState(JSON.stringify(exampleSchema, null, 2));
  const [instanceTitle, setInstanceTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const headers = useCallback((json = false): Record<string, string> => ({
    Authorization: 'Bearer ' + token,
    ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }), [token, tenantId]);

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(API + path, { ...init, headers: headers(init.body !== undefined), cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || 'درخواست ناموفق بود');
    return data;
  }, [headers]);

  useEffect(() => {
    setToken(localStorage.getItem('fsb.accessToken') || '');
    setTenantId(localStorage.getItem('fsb.tenantId') || '');
    setOrganizationId(localStorage.getItem('fsb.organizationId') || '');
  }, []);

  const loadOrganizations = useCallback(async () => {
    if (!token) return;
    try {
      const rows = await api('/organizations/accessible');
      const available = Array.isArray(rows) ? rows as OrganizationOption[] : [];
      setOrganizations(available);
      setOrganizationId(current => {
        const next = current && available.some(item => item.id === current) ? current : (available[0]?.id ?? current);
        if (next) localStorage.setItem('fsb.organizationId', next);
        return next;
      });
    } catch {
      // Process permissions may be narrower than organization.read; manual UUID entry remains available.
      setOrganizations([]);
    }
  }, [token, api]);

  const loadDefinitions = useCallback(async () => {
    if (!token || !organizationId.trim()) return;
    setBusy(true);
    try {
      const rows = await api('/process-definitions?organizationId=' + encodeURIComponent(organizationId.trim()));
      setDefinitions(Array.isArray(rows) ? rows : []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'دریافت فرایندها ناموفق بود');
    } finally {
      setBusy(false);
    }
  }, [token, organizationId, api]);

  const loadVersions = useCallback(async (definitionId: string) => {
    if (!definitionId) { setVersions([]); return; }
    try {
      const rows = await api('/process-definitions/' + definitionId + '/versions');
      setVersions(Array.isArray(rows) ? rows : []);
      setSelectedVersionId('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'دریافت نسخه‌ها ناموفق بود');
    }
  }, [api]);

  useEffect(() => {
    if (token) void loadOrganizations();
  }, [token, loadOrganizations]);

  useEffect(() => {
    if (token && organizationId.trim()) void loadDefinitions();
  }, [token, organizationId, loadDefinitions]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const response = await fetch(API + '/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || 'ورود ناموفق بود');
      localStorage.setItem('fsb.accessToken', data.accessToken);
      if (tenantId.trim()) localStorage.setItem('fsb.tenantId', tenantId.trim());
      setToken(data.accessToken);
      setNotice('ورود انجام شد؛ شناسه سازمان را وارد کنید.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ورود ناموفق بود');
    } finally { setBusy(false); }
  }

  async function createDefinition(event: FormEvent) {
    event.preventDefault();
    if (!organizationId.trim()) { setError('شناسه سازمان را وارد کنید.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const created = await api('/process-definitions', {
        method: 'POST',
        body: JSON.stringify({ organizationId: organizationId.trim(), code: code.trim(), name: name.trim(), description: description.trim() || undefined }),
      });
      setCode(''); setName(''); setDescription('');
      await loadDefinitions();
      setSelectedId(created.id);
      await loadVersions(created.id);
      setNotice('تعریف فرایند ایجاد شد. اکنون یک نسخه بسازید.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ایجاد فرایند ناموفق بود');
    } finally { setBusy(false); }
  }

  async function createVersion(event: FormEvent) {
    event.preventDefault();
    if (!selectedId) { setError('ابتدا یک فرایند انتخاب کنید.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const schema = JSON.parse(schemaText);
      if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('Schema باید یک شیء JSON باشد.');
      const created = await api('/process-definitions/' + selectedId + '/versions', {
        method: 'POST', body: JSON.stringify({ schema, changeNote: changeNote.trim() || undefined }),
      });
      setChangeNote('');
      await loadVersions(selectedId);
      setSelectedVersionId(created.id);
      setNotice('نسخه پیش‌نویس ایجاد شد. پس از بررسی مراحل و مسیرها آن را منتشر کنید.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ساخت نسخه ناموفق بود');
    } finally { setBusy(false); }
  }

  async function publishVersion(versionId: string) {
    if (!selectedId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api('/process-definitions/' + selectedId + '/versions/' + versionId + '/publish', { method: 'POST' });
      await loadVersions(selectedId);
      setSelectedVersionId(versionId);
      setNotice('نسخه منتشر شد و برای شروع فرایند قابل استفاده است.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'انتشار نسخه ناموفق بود');
    } finally { setBusy(false); }
  }

  async function startProcess(event: FormEvent) {
    event.preventDefault();
    const version = versions.find(item => item.id === selectedVersionId);
    if (!version || version.status !== 'PUBLISHED') { setError('برای شروع، یک نسخه منتشرشده انتخاب کنید.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await api('/process-instances', {
        method: 'POST',
        body: JSON.stringify({ processVersionId: version.id, organizationId: organizationId.trim(), title: instanceTitle.trim() }),
      });
      setInstanceTitle('');
      setNotice('فرایند آغاز شد. برای پیگیری و اقدام به کارتابل ورودی/خروجی بروید.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'شروع فرایند ناموفق بود');
    } finally { setBusy(false); }
  }

  const selected = definitions.find(item => item.id === selectedId);
  const selectedVersion = versions.find(item => item.id === selectedVersionId);
  const inputStyle: React.CSSProperties = { width: '100%', padding: 10, border: '1px solid #d0d5dd', borderRadius: 8, font: 'inherit' };
  const panelStyle: React.CSSProperties = { background: 'var(--panel, #fff)', border: '1px solid #e4e8f0', borderRadius: 14, padding: 18, minWidth: 0 };
  const buttonStyle: React.CSSProperties = { padding: '9px 14px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', cursor: 'pointer', font: 'inherit' };

  if (!token) return (
    <main dir="rtl" style={{ maxWidth: 480, margin: '48px auto', padding: 24, ...panelStyle }}>
      <h1>طراحی فرایند</h1>
      <p>برای مدیریت تعریف‌ها و نسخه‌های فرایند وارد شوید.</p>
      <form onSubmit={login} style={{ display: 'grid', gap: 12 }}>
        <input style={inputStyle} placeholder="نام کاربری" value={username} onChange={e => setUsername(e.target.value)} required />
        <input style={inputStyle} type="password" placeholder="گذرواژه" value={password} onChange={e => setPassword(e.target.value)} required />
        <input style={inputStyle} placeholder="شناسه Tenant (در صورت نیاز)" value={tenantId} onChange={e => setTenantId(e.target.value)} />
        <button disabled={busy} style={buttonStyle}>ورود</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  );

  return (
    <main dir="rtl" style={{ maxWidth: 1240, margin: '0 auto', padding: 24, display: 'grid', gap: 18 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div><p style={{ color: '#64748b', marginBottom: 4 }}>F-S / PROCESS DESIGNER</p><h1 style={{ margin: 0 }}>طراحی و انتشار فرایند</h1><p>تعریف مراحل، مسئولان، سیاست تأیید و مسیرهای انتقال</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/tasks" style={{ ...buttonStyle, textDecoration: 'none' }}>کارتابل گردش کار</a>
          <button style={buttonStyle} onClick={() => { localStorage.removeItem('fsb.accessToken'); setToken(''); }}>خروج</button>
        </div>
      </header>

      {error && <p role="alert" style={{ color: '#b42318', background: '#fef3f2', padding: 10, borderRadius: 8 }}>{error}</p>}
      {notice && <p role="status" style={{ color: '#067647', background: '#ecfdf3', padding: 10, borderRadius: 8 }}>{notice}</p>}

      <section style={panelStyle}>
        <h2>دامنه سازمان</h2>
        <p>شناسه سازمان باید متعلق به Tenant فعال شما باشد؛ مجوز سازمانی در سرور کنترل می‌شود.</p>
        <div style={{ display: 'grid', gap: 8 }}>
          <select style={inputStyle} value={organizations.some(item => item.id === organizationId) ? organizationId : ''} onChange={e => { const next = e.target.value; setOrganizationId(next); setSelectedId(''); setVersions([]); setSelectedVersionId(''); if (next) localStorage.setItem('fsb.organizationId', next); }}>
            <option value="">انتخاب سازمان از فهرست مجاز</option>
            {organizations.map(item => <option key={item.id} value={item.id}>{item.name}{item.code ? ' · ' + item.code : ''}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input style={{ ...inputStyle, flex: '1 1 360px' }} placeholder="یا UUID سازمان را دستی وارد کنید" value={organizationId} onChange={e => { setOrganizationId(e.target.value); setSelectedId(''); setVersions([]); setSelectedVersionId(''); }} />
            <button style={buttonStyle} disabled={busy || !organizationId.trim()} onClick={() => { localStorage.setItem('fsb.organizationId', organizationId.trim()); void loadDefinitions(); }}>بارگذاری فرایندها</button>
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, .85fr) minmax(0, 1.4fr)', gap: 18, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 18 }}>
          <section style={panelStyle}>
            <h2>تعریف جدید</h2>
            <form onSubmit={createDefinition} style={{ display: 'grid', gap: 10 }}>
              <input style={inputStyle} placeholder="کد یکتا در سازمان" value={code} onChange={e => setCode(e.target.value)} minLength={2} maxLength={120} required />
              <input style={inputStyle} placeholder="نام فرایند" value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={200} required />
              <textarea style={inputStyle} placeholder="توضیحات (اختیاری)" value={description} onChange={e => setDescription(e.target.value)} rows={3} />
              <button style={buttonStyle} disabled={busy || !organizationId.trim()}>ایجاد تعریف فرایند</button>
            </form>
          </section>

          <section style={panelStyle}>
            <h2>فرایندهای سازمان</h2>
            {!definitions.length && <p>فرایندی برای این سازمان بارگذاری نشده است.</p>}
            <div style={{ display: 'grid', gap: 8 }}>
              {definitions.map(item => (
                <button key={item.id} onClick={() => { setSelectedId(item.id); void loadVersions(item.id); }} style={{ ...buttonStyle, textAlign: 'right', borderColor: selectedId === item.id ? '#2563eb' : '#cbd5e1' }}>
                  <strong>{item.name}</strong><div style={{ color: '#64748b', fontSize: 12 }}>{item.code} · {item.status}</div>
                </button>
              ))}
            </div>
          </section>
        </div>

        <div style={{ display: 'grid', gap: 18 }}>
          <section style={panelStyle}>
            <h2>نسخه‌بندی و طراحی مراحل</h2>
            {selected ? <p><strong>{selected.name}</strong> · {selected.code}</p> : <p>ابتدا یک فرایند از فهرست انتخاب کنید.</p>}
            <form onSubmit={createVersion} style={{ display: 'grid', gap: 10 }}>
              <input style={inputStyle} placeholder="یادداشت تغییر نسخه" value={changeNote} onChange={e => setChangeNote(e.target.value)} maxLength={500} />
              <label>Schema نسخه (JSON): مراحل، مسئولان و مسیرهای APPROVED / REJECTED / RETURNED</label>
              <textarea spellCheck={false} style={{ ...inputStyle, fontFamily: 'monospace', direction: 'ltr', textAlign: 'left' }} rows={22} value={schemaText} onChange={e => setSchemaText(e.target.value)} />
              <p style={{ color: '#667085', fontSize: 13, lineHeight: 1.8 }}>
                شناسه‌های نمونه را با UUID واقعی کاربران، سمت‌ها یا واحدهای فعال همان سازمان جایگزین کنید. هر مرحله باید حداقل یک منبع تخصیص معتبر داشته باشد. سیاست ALL یعنی همه مسئولان باید تأیید کنند؛ ANY با اولین تأیید تکمیل می‌شود.
              </p>
              <button style={buttonStyle} disabled={busy || !selectedId}>ایجاد نسخه پیش‌نویس</button>
            </form>
          </section>

          <section style={panelStyle}>
            <h2>نسخه‌ها و انتشار</h2>
            {!versions.length && <p>هنوز نسخه‌ای برای این فرایند وجود ندارد.</p>}
            <div style={{ display: 'grid', gap: 8 }}>
              {versions.map(version => (
                <article key={version.id} style={{ border: '1px solid #e4e8f0', borderRadius: 10, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button style={{ ...buttonStyle, textAlign: 'right', borderColor: selectedVersionId === version.id ? '#2563eb' : '#cbd5e1' }} onClick={() => { setSelectedVersionId(version.id); setSchemaText(JSON.stringify(version.schema, null, 2)); }}>
                    <strong>نسخه {version.versionNumber}</strong><div style={{ color: '#64748b', fontSize: 12 }}>{version.status}</div>
                  </button>
                  {version.status === 'DRAFT' && <button style={buttonStyle} disabled={busy} onClick={() => void publishVersion(version.id)}>اعتبارسنجی و انتشار</button>}
                </article>
              ))}
            </div>
          </section>

          <section style={panelStyle}>
            <h2>شروع فرایند</h2>
            <form onSubmit={startProcess} style={{ display: 'grid', gap: 10 }}>
              <p>{selectedVersion?.status === 'PUBLISHED' ? 'نسخه منتشرشده انتخاب شده است.' : 'برای شروع، یک نسخه منتشرشده را از فهرست نسخه‌ها انتخاب کنید.'}</p>
              <input style={inputStyle} placeholder="عنوان نمونه فرایند" value={instanceTitle} onChange={e => setInstanceTitle(e.target.value)} minLength={2} maxLength={240} required />
              <button style={buttonStyle} disabled={busy || selectedVersion?.status !== 'PUBLISHED' || !organizationId.trim()}>شروع و ایجاد وظیفه مرحله اول</button>
            </form>
          </section>
        </div>
      </section>
    </main>
  );
}
