"use client";

import { useCallback, useEffect, useState, type CSSProperties } from 'react';

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api').replace(/\/$/, '');
type Transition = { fromStepIndex: number; action: 'APPROVED' | 'REJECTED' | 'RETURNED'; toStepIndex: number | null };
type Step = { title?: string; instructions?: string; assigneeUserIds?: string[]; assigneePositionIds?: string[]; assigneeUnitIds?: string[] };
type ProcessSchema = { steps?: Step[]; transitions?: Transition[] };
type Task = {
  id: string;
  title: string;
  status: string;
  dueAt?: string | null;
  createdAt: string;
  processInstance: {
    id: string;
    title: string;
    currentStepIndex: number;
    processVersion: { schema: ProcessSchema };
  };
};
type ProcessItem = {
  id: string;
  title: string;
  status: string;
  currentStepIndex: number;
  startedAt: string;
  processVersion: { schema: ProcessSchema };
};
type ProcessDetail = ProcessItem & {
  tasks: Array<{ id: string; title: string; status: string; assignmentPolicy: string; assignees?: Array<{ userId: string; status: string }> }>;
  actionLogs: Array<{ id: string; action: string; userId: string; comment?: string | null; createdAt: string }>;
  lifecycleEvents: Array<{ id: string; eventType: string; affectedUserId?: string | null; details?: unknown; createdAt: string }>;
  reassignments: Array<{ id: string; triggerType: string; fromUserIds: string[]; toUserIds: string[]; reason: string; createdAt: string }>;
};

export default function TasksPage() {
  const [token, setToken] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [processes, setProcesses] = useState<ProcessItem[]>([]);
  const [detail, setDetail] = useState<ProcessDetail | null>(null);
  const [activeTab, setActiveTab] = useState<'inbox' | 'outbox'>('inbox');
  const [busy, setBusy] = useState(false);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [loadingOutbox, setLoadingOutbox] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [returnTask, setReturnTask] = useState('');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');

  const headers = useCallback(() => ({
    Authorization: 'Bearer ' + token,
    ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
  }), [token, tenantId]);

  const loadInbox = useCallback(async () => {
    if (!token) return;
    setLoadingInbox(true);
    try {
      const response = await fetch(API + '/tasks/my', { headers: headers(), cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || 'دریافت کارتابل ورودی ناموفق بود');
      setTasks(Array.isArray(data) ? data : []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت کارتابل');
    } finally {
      setLoadingInbox(false);
    }
  }, [token, headers]);

  const loadOutbox = useCallback(async () => {
    if (!token) return;
    setLoadingOutbox(true);
    try {
      const response = await fetch(API + '/process-instances/my', { headers: headers(), cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || 'دریافت کارتابل خروجی ناموفق بود');
      setProcesses(Array.isArray(data) ? data : []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت کارتابل خروجی');
    } finally {
      setLoadingOutbox(false);
    }
  }, [token, headers]);

  useEffect(() => {
    setToken(localStorage.getItem('fsb.accessToken') || '');
    setTenantId(localStorage.getItem('fsb.tenantId') || '');
  }, []);

  useEffect(() => {
    if (token) {
      void loadInbox();
      void loadOutbox();
    }
  }, [token, loadInbox, loadOutbox]);

  async function refreshAll() {
    await Promise.all([loadInbox(), loadOutbox()]);
    if (detail) await openProcess(detail.id);
  }

  async function openProcess(id: string) {
    if (!token) return;
    setDetailLoading(true);
    try {
      const response = await fetch(API + '/process-instances/' + id, { headers: headers(), cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || 'دریافت جزئیات فرایند ناموفق بود');
      setDetail(data as ProcessDetail);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت جزئیات فرایند');
    } finally {
      setDetailLoading(false);
    }
  }

  async function act(taskId: string, action: 'APPROVED' | 'REJECTED' | 'RETURNED', returnToStepIndex?: number) {
    setBusy(true);
    setError('');
    try {
      const body: Record<string, unknown> = { action };
      if (action === 'RETURNED') {
        body.returnToStepIndex = returnToStepIndex;
        body.comment = reason.trim();
      }
      const response = await fetch(API + '/tasks/' + taskId + '/actions', {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || 'ثبت اقدام ناموفق بود');
      setReturnTask('');
      setReason('');
      await Promise.all([loadInbox(), loadOutbox()]);
      if (detail) await openProcess(detail.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در ثبت اقدام');
    } finally {
      setBusy(false);
    }
  }

  function returnTargets(task: Task): number[] {
    const schema = task.processInstance?.processVersion?.schema;
    const current = task.processInstance?.currentStepIndex ?? 0;
    if (Array.isArray(schema?.transitions)) {
      return [...new Set(schema.transitions
        .filter(edge => edge.fromStepIndex === current && edge.action === 'RETURNED' && Number.isInteger(edge.toStepIndex) && edge.toStepIndex! < current)
        .map(edge => edge.toStepIndex as number))].sort((a, b) => a - b);
    }
    return Array.from({ length: current }, (_, index) => index);
  }

  const buttonStyle: CSSProperties = { padding: '8px 14px', borderRadius: 8, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer' };
  const cardStyle: CSSProperties = { background: '#fff', border: '1px solid #e4e8f0', borderRadius: 14, padding: 18 };

  return (
    <main dir="rtl" style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1>کارتابل گردش کار</h1>
          <p>وظایف ارجاع‌شده و فرایندهایی که آغاز کرده‌اید</p>
        </div>
        <button disabled={loadingInbox || loadingOutbox || busy} style={buttonStyle} onClick={() => void refreshAll()}>بروزرسانی</button>
      </header>

      <nav aria-label="نوع کارتابل" style={{ display: 'flex', gap: 8, margin: '18px 0' }}>
        <button aria-pressed={activeTab === 'inbox'} style={{ ...buttonStyle, background: activeTab === 'inbox' ? '#eef4ff' : '#fff' }} onClick={() => setActiveTab('inbox')}>
          کارتابل ورودی ({tasks.length})
        </button>
        <button aria-pressed={activeTab === 'outbox'} style={{ ...buttonStyle, background: activeTab === 'outbox' ? '#eef4ff' : '#fff' }} onClick={() => setActiveTab('outbox')}>
          کارتابل خروجی ({processes.length})
        </button>
      </nav>

      {error && <p role="alert" style={{ color: '#a11' }}>{error}</p>}

      {activeTab === 'inbox' && (
        <section style={{ display: 'grid', gap: 14, marginTop: 18 }}>
          {loadingInbox && <p>در حال دریافت وظایف…</p>}
          {!tasks.length && !loadingInbox && <p>وظیفه قابل اقدامی در کارتابل ورودی وجود ندارد.</p>}
          {tasks.map(task => {
            const schema = task.processInstance?.processVersion?.schema;
            const steps = schema?.steps || [];
            const current = task.processInstance?.currentStepIndex ?? 0;
            const targets = returnTargets(task);
            return (
              <article key={task.id} style={cardStyle}>
                <h2 style={{ margin: '0 0 6px' }}>{task.title}</h2>
                <p>{task.processInstance?.title} · مرحله {current + 1} از {steps.length || '—'}</p>
                <p style={{ color: '#667085' }}>مهلت: {task.dueAt ? new Date(task.dueAt).toLocaleString('fa-IR') : 'بدون مهلت'}</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button disabled={busy} style={buttonStyle} onClick={() => void act(task.id, 'APPROVED')}>تأیید</button>
                  <button disabled={busy} style={buttonStyle} onClick={() => void act(task.id, 'REJECTED')}>رد</button>
                  {targets.length > 0 && <button disabled={busy} style={buttonStyle} onClick={() => {
                    setReturnTask(returnTask === task.id ? '' : task.id);
                    setTarget(String(targets[targets.length - 1]));
                    setReason('');
                  }}>بازگشت به مرحله قبل</button>}
                </div>
                {returnTask === task.id && (
                  <div style={{ marginTop: 14, padding: 14, background: '#f7f8fa', borderRadius: 10, display: 'grid', gap: 10 }}>
                    <label>مرحله مقصد
                      <select value={target} onChange={event => setTarget(event.target.value)}>
                        {targets.map(index => <option key={index} value={index}>{index + 1}. {steps[index]?.title || 'مرحله ' + (index + 1)}</option>)}
                      </select>
                    </label>
                    <label>دلیل بازگشت
                      <textarea value={reason} onChange={event => setReason(event.target.value)} rows={3} maxLength={4000} placeholder="دلیل و موارد نیازمند اصلاح را بنویسید" />
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button disabled={busy || reason.trim().length < 3 || target === ''} style={buttonStyle} onClick={() => void act(task.id, 'RETURNED', Number(target))}>ثبت بازگشت</button>
                      <button disabled={busy} style={buttonStyle} onClick={() => setReturnTask('')}>انصراف</button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}

      {activeTab === 'outbox' && (
        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 0.85fr) minmax(0, 1.5fr)', gap: 14, marginTop: 18 }}>
          <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
            {loadingOutbox && <p>در حال دریافت فرایندها…</p>}
            {!processes.length && !loadingOutbox && <p>فرایندی که آغاز کرده باشید یافت نشد.</p>}
            {processes.map(process => (
              <button key={process.id} onClick={() => void openProcess(process.id)} style={{ ...cardStyle, textAlign: 'right', cursor: 'pointer', borderColor: detail?.id === process.id ? '#5277bd' : '#e4e8f0' }}>
                <strong>{process.title}</strong>
                <div style={{ marginTop: 6, color: '#667085' }}>وضعیت: {process.status} · مرحله {process.currentStepIndex + 1}</div>
                <small>{new Date(process.startedAt).toLocaleString('fa-IR')}</small>
              </button>
            ))}
          </div>
          <div style={{ ...cardStyle, minHeight: 220 }}>
            {detailLoading && <p>در حال دریافت جزئیات…</p>}
            {!detail && !detailLoading && <p>برای مشاهده مسیر، وظایف و تاریخچه، یک فرایند را انتخاب کنید.</p>}
            {detail && !detailLoading && (
              <div>
                <h2 style={{ marginTop: 0 }}>{detail.title}</h2>
                <p>وضعیت: {detail.status} · مرحله جاری: {(detail.currentStepIndex ?? 0) + 1}</p>
                <h3>مراحل و وظایف</h3>
                <div style={{ display: 'grid', gap: 8 }}>
                  {(detail.tasks || []).map(task => (
                    <div key={task.id} style={{ border: '1px solid #e4e8f0', borderRadius: 8, padding: 10 }}>
                      <strong>{task.title}</strong>
                      <div>وضعیت: {task.status} · سیاست تخصیص: {task.assignmentPolicy}</div>
                      <small>مسئولان: {(task.assignees || []).map(assignee => assignee.userId + ' (' + assignee.status + ')').join('، ') || '—'}</small>
                    </div>
                  ))}
                </div>
                <h3>تاریخچه اقدامات</h3>
                <ol>
                  {(detail.actionLogs || []).map(log => (
                    <li key={log.id}>{log.action} · {log.userId} · {new Date(log.createdAt).toLocaleString('fa-IR')}{log.comment ? ' · ' + log.comment : ''}</li>
                  ))}
                  {!detail.actionLogs?.length && <li>اقدامی ثبت نشده است.</li>}
                </ol>
                <h3>تاریخچه ارجاع مجدد</h3>
                <ol>
                  {(detail.reassignments || []).map(item => (
                    <li key={item.id}>{item.triggerType} · {item.fromUserIds.join('، ') || '—'} ← {item.toUserIds.join('، ') || '—'} · {item.reason} · {new Date(item.createdAt).toLocaleString('fa-IR')}</li>
                  ))}
                  {!detail.reassignments?.length && <li>ارجاع مجددی ثبت نشده است.</li>}
                </ol>
                <h3>رویدادهای چرخه عمر</h3>
                <ol>
                  {(detail.lifecycleEvents || []).map(event => (
                    <li key={event.id}>{event.eventType} · {event.affectedUserId || '—'} · {new Date(event.createdAt).toLocaleString('fa-IR')}</li>
                  ))}
                  {!detail.lifecycleEvents?.length && <li>رویدادی ثبت نشده است.</li>}
                </ol>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
