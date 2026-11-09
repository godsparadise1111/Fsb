"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api').replace(/\/$/, '');
type Field = { key: string; label: string; type: 'text' | 'date' | 'number'; groupable: boolean; filterable: boolean };
type Source = { key: string; label: string; fields: Field[]; aggregates: string[] };
type Filter = { field: string; operator: string; value: string };
type Spec = { source: string; from: string; to: string; groupBy?: string; aggregate: string; measure?: string; filters: Array<{field:string;operator:string;value:unknown}>; limit: number; organizationId?: string };
type Organization = { id:string; name:string; code:string };
type Schedule = { id:string; frequency:string; weekday:number|null; timeOfDay:string; timezone:string; isActive:boolean; nextRunAt:string };
type Result = { sourceLabel: string; groupLabel: string | null; measureLabel: string; period: {from:string;to:string}; rows: Array<{dimension:string|null;value:number|null}>; rowCount:number; generatedAt:string };
type Saved = { id:string; title:string; description:string|null; isShared:boolean; ownerUserId:string; isOwner:boolean };

const today = () => new Date().toISOString().slice(0, 10);
const monthAgo = () => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
const panel: React.CSSProperties = { background: 'var(--surface, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 16, padding: 18, margin: '18px 0' };
const control: React.CSSProperties = { padding: '9px 11px', border: '1px solid var(--border, #d1d5db)', borderRadius: 9, minWidth: 0, maxWidth: '100%', background: 'var(--surface, #fff)', color: 'inherit' };
const button: React.CSSProperties = { ...control, cursor: 'pointer', fontWeight: 600 };

export default function ReportBuilderPanel() {
  const [token,setToken] = useState('');
  const [tenantId,setTenantId] = useState('');
  const [catalog,setCatalog] = useState<Source[]>([]);
  const [organizations,setOrganizations] = useState<Organization[]>([]);
  const [organizationId,setOrganizationId] = useState('');
  const [schedules,setSchedules] = useState<Schedule[]>([]);
  const [jobId,setJobId] = useState('');
  const [jobStatus,setJobStatus] = useState('');
  const [frequency,setFrequency] = useState('DAILY');
  const [weekday,setWeekday] = useState(1);
  const [scheduleTime,setScheduleTime] = useState('08:00');
  const [saved,setSaved] = useState<Saved[]>([]);
  const [sourceKey,setSourceKey] = useState('');
  const [groupBy,setGroupBy] = useState('');
  const [aggregate,setAggregate] = useState('count');
  const [measure,setMeasure] = useState('');
  const [from,setFrom] = useState(monthAgo());
  const [to,setTo] = useState(today());
  const [filters,setFilters] = useState<Filter[]>([]);
  const [title,setTitle] = useState('');
  const [description,setDescription] = useState('');
  const [isShared,setIsShared] = useState(false);
  const [loadedId,setLoadedId] = useState('');
  const [canEdit,setCanEdit] = useState(true);
  const [result,setResult] = useState<Result|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');

  const request = useCallback(async (path:string, init:RequestInit = {}) => {
    const response = await fetch(API + path, {
      ...init,
      headers: { 'Content-Type':'application/json', Authorization:'Bearer ' + token, ...(tenantId ? {'X-Tenant-Id':tenantId} : {}), ...(init.headers || {}) },
    });
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json().catch(()=>null) : await response.blob();
    if (!response.ok) throw new Error((data as any)?.message || 'عملیات گزارش‌ساز ناموفق بود');
    return data;
  },[token,tenantId]);

  const source = useMemo(()=>catalog.find(item=>item.key===sourceKey),[catalog,sourceKey]);
  const groupFields = source?.fields.filter(field=>field.groupable) ?? [];
  const numericFields = source?.fields.filter(field=>field.type==='number') ?? [];

  const scopedPath = useCallback((path:string)=>path+(path.includes('?')?'&':'?')+'organizationId='+encodeURIComponent(organizationId),[organizationId]);
  const refreshSaved = useCallback(async()=>{
    const items = await request(scopedPath('/tenant/report-builder/saved'));
    setSaved(items || []);
  },[request,scopedPath]);
  const refreshSchedules = useCallback(async()=>{
    const items = await request(scopedPath('/tenant/report-builder/schedules'));
    setSchedules(items || []);
  },[request,scopedPath]);

  useEffect(()=>{
    const accessToken = localStorage.getItem('fsb.accessToken') || '';
    const activeTenant = localStorage.getItem('fsb.tenantId') || '';
    setToken(accessToken); setTenantId(activeTenant);
    const requestedJob = new URLSearchParams(window.location.search).get('jobId');
    if(requestedJob) setJobId(requestedJob);
  },[]);

  useEffect(()=>{
    if (!token) return;
    let active = true;
    request('/tenant/report-builder/organizations/accessible').then(items=>{
      if(!active) return;
      setOrganizations(items||[]);
      if(items?.length) setOrganizationId(current=>current||items[0].id);
    }).catch(error=>{if(active)setError(error instanceof Error?error.message:'دریافت سازمان‌های مجاز ناموفق بود')});
    return ()=>{active=false};
  },[token,request]);

  useEffect(()=>{
    if (!token || !organizationId) return;
    let active = true;
    Promise.all([
      request(scopedPath('/tenant/report-builder/catalog')),
      request(scopedPath('/tenant/report-builder/saved')),
      request(scopedPath('/tenant/report-builder/schedules')),
    ]).then(([items,reports,scheduled])=>{
      if (!active) return;
      setCatalog(items || []); setSaved(reports || []); setSchedules(scheduled||[]);
      if (items?.length) setSourceKey(items[0].key);
    }).catch(error=>{if(active)setError(error instanceof Error?error.message:'خطا در دریافت تنظیمات گزارش‌ساز')});
    return ()=>{active=false};
  },[token,organizationId,request,scopedPath]);

  useEffect(()=>{
    if (!source) return;
    if (groupBy && !source.fields.some(field=>field.key===groupBy && field.groupable)) setGroupBy('');
    if (aggregate!=='count' && !numericFields.some(field=>field.key===measure)) setMeasure(numericFields[0]?.key || '');
    if (!source.aggregates.includes(aggregate)) {setAggregate('count');setMeasure('');}
    setFilters(current=>current.filter(filter=>source.fields.some(field=>field.key===filter.field && field.filterable)));
  },[source,sourceKey]);

  function makeSpec():Spec {
    return {source:sourceKey,from,to,organizationId:organizationId||undefined,groupBy:groupBy||undefined,aggregate,measure:aggregate==='count'?undefined:measure,
      filters:filters.filter(item=>item.field && item.value.trim()).map(item=>({field:item.field,operator:item.operator,value:item.operator==='in'?item.value.split(',').map(value=>value.trim()).filter(Boolean):item.value})),limit:200};
  }

  async function run() {
    setBusy(true);setError('');
    try { const data=await request('/tenant/report-builder/run',{method:'POST',body:JSON.stringify(makeSpec())});setResult(data); }
    catch(error){setError(error instanceof Error?error.message:'اجرای گزارش ناموفق بود');}
    finally{setBusy(false);}
  }

  async function save() {
    setBusy(true);setError('');
    try {
      const payload={title,description,isShared,organizationId,config:makeSpec()};
      const data=await request(loadedId?('/tenant/report-builder/saved/'+loadedId):'/tenant/report-builder/saved',{method:loadedId?'PATCH':'POST',body:JSON.stringify(payload)});
      setLoadedId(data.id);setCanEdit(true);await refreshSaved();
    } catch(error){setError(error instanceof Error?error.message:'ذخیره گزارش ناموفق بود');}
    finally{setBusy(false);}
  }

  async function loadSaved(id:string) {
    setBusy(true);setError('');
    try {
      const data=await request(scopedPath('/tenant/report-builder/saved/'+id));
      const config=data.config as Spec;
      setLoadedId(data.id);setCanEdit(data.isOwner===true);setTitle(data.title);setDescription(data.description||'');setIsShared(data.isShared);
      setSourceKey(config.source);setFrom(config.from||monthAgo());setTo(config.to||today());setGroupBy(config.groupBy||'');
      setAggregate(config.aggregate);setMeasure(config.measure||'');
      setFilters((config.filters||[]).map((filter:any)=>({field:filter.field,operator:filter.operator,value:Array.isArray(filter.value)?filter.value.join(','):String(filter.value)})));
      const output=await request(scopedPath('/tenant/report-builder/saved/'+id+'/run'));
      setResult(output.result);
    } catch(error){setError(error instanceof Error?error.message:'بارگذاری گزارش ناموفق بود');}
    finally{setBusy(false);}
  }

  async function removeSaved(id:string) {
    if (!window.confirm('این گزارش ذخیره‌شده حذف شود؟')) return;
    setBusy(true);setError('');
    try {await request(scopedPath('/tenant/report-builder/saved/'+id),{method:'DELETE'});if(loadedId===id){setLoadedId('');setCanEdit(true);setTitle('');}await refreshSaved();}
    catch(error){setError(error instanceof Error?error.message:'حذف گزارش ناموفق بود');}
    finally{setBusy(false);}
  }

  async function exportCsv() {
    if(!loadedId){setError('ابتدا گزارش را ذخیره کنید تا خروجی CSV آن دریافت شود.');return;}
    setBusy(true);setError('');
    try {
      const blob=await request(scopedPath('/tenant/report-builder/saved/'+loadedId+'/export.csv'));
      const url=URL.createObjectURL(blob as Blob);const anchor=document.createElement('a');anchor.href=url;anchor.download='fsb-custom-report.csv';anchor.click();URL.revokeObjectURL(url);
    } catch(error){setError(error instanceof Error?error.message:'دریافت خروجی ناموفق بود');}
    finally{setBusy(false);}
  }

  async function exportFile(format:'xlsx'|'pdf') {
    if(!loadedId){setError('ابتدا گزارش را ذخیره کنید.');return;}
    setBusy(true);setError('');
    try {
      const blob=await request(scopedPath('/tenant/report-builder/saved/'+loadedId+'/export.'+format));
      const url=URL.createObjectURL(blob as Blob);const anchor=document.createElement('a');anchor.href=url;anchor.download='fsb-custom-report.'+format;anchor.click();URL.revokeObjectURL(url);
    } catch(error){setError(error instanceof Error?error.message:'دریافت خروجی ناموفق بود');}
    finally{setBusy(false);}
  }

  async function enqueueReport() {
    setBusy(true);setError('');
    try {
      const job=await request('/tenant/report-builder/jobs',{method:'POST',body:JSON.stringify(makeSpec())});
      setJobId(job.id);setJobStatus(job.status||'PENDING');
    } catch(error){setError(error instanceof Error?error.message:'ثبت گزارش پس‌زمینه ناموفق بود');}
    finally{setBusy(false);}
  }

  async function refreshJob() {
    if(!jobId)return;
    setBusy(true);
    try {
      const job=await request(scopedPath('/tenant/report-builder/jobs/'+jobId));
      setJobStatus(job.status);
      if(job.result)setResult(job.result);
      if(job.error)setError(job.error);
    } catch(error){setError(error instanceof Error?error.message:'دریافت وضعیت گزارش ناموفق بود');}
    finally{setBusy(false);}
  }

  async function createSchedule() {
    setBusy(true);setError('');
    try {
      await request('/tenant/report-builder/schedules',{method:'POST',body:JSON.stringify({
        config:makeSpec(),organizationId,frequency,weekday:frequency==='WEEKLY'?weekday:undefined,
        timeOfDay:scheduleTime,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',
      })});
      await refreshSchedules();
    } catch(error){setError(error instanceof Error?error.message:'ایجاد زمان‌بندی ناموفق بود');}
    finally{setBusy(false);}
  }

  async function toggleSchedule(item:Schedule) {
    setBusy(true);
    try {
      await request('/tenant/report-builder/schedules/'+item.id+'/active',{method:'PATCH',body:JSON.stringify({active:!item.isActive,organizationId})});
      await refreshSchedules();
    } catch(error){setError(error instanceof Error?error.message:'تغییر زمان‌بندی ناموفق بود');}
    finally{setBusy(false);}
  }

  useEffect(()=>{
    if(!token||!organizationId||!jobId)return;
    let active=true;
    request(scopedPath('/tenant/report-builder/jobs/'+jobId)).then(job=>{
      if(!active)return;
      setJobStatus(job.status||'');
      if(job.result)setResult(job.result);
      if(job.error)setError(job.error);
    }).catch(error=>{if(active)setError(error instanceof Error?error.message:'بازیابی گزارش زمان‌بندی‌شده ناموفق بود')});
    return ()=>{active=false};
  },[token,organizationId,jobId,request,scopedPath]);

  const maxValue=Math.max(1,...(result?.rows||[]).map(row=>Math.abs(row.value||0)));
  return <section style={panel} dir="rtl">
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}>
      <div><h2 style={{margin:'0 0 6px'}}>گزارش‌ساز پویا</h2><p style={{margin:0,opacity:.75}}>گزارش بسازید، ذخیره کنید و با اعضای مجاز مشتری به اشتراک بگذارید.</p></div>
      <span style={{fontSize:12,opacity:.7}}>منابع داده محدود و امن · حداکثر ۲۰۰ ردیف</span>
    </div>
    {error&&<p role="alert" style={{color:'#b42318',marginTop:12}}>{error}</p>}
    <label style={{display:'grid',gap:6,marginTop:16}}>سازمان گزارش<select style={control} value={organizationId} onChange={e=>{setOrganizationId(e.target.value);setResult(null);setLoadedId('');setCatalog([]);setSaved([])}}>{organizations.map(org=><option key={org.id} value={org.id}>{org.name} · {org.code}</option>)}</select></label>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,220px),1fr))',gap:12,marginTop:18}}>
      <label style={{display:'grid',gap:6}}>منبع داده<select style={control} value={sourceKey} onChange={e=>{setSourceKey(e.target.value);setGroupBy('');setFilters([]);setAggregate('count');setMeasure('');setResult(null);setLoadedId('')}}>{catalog.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      <label style={{display:'grid',gap:6}}>گروه‌بندی<select style={control} value={groupBy} onChange={e=>setGroupBy(e.target.value)}><option value="">بدون گروه‌بندی · کل</option>{groupFields.map(field=><option key={field.key} value={field.key}>{field.label}</option>)}</select></label>
      <label style={{display:'grid',gap:6}}>نوع محاسبه<select style={control} value={aggregate} onChange={e=>setAggregate(e.target.value)}>{(source?.aggregates||['count']).map(item=><option key={item} value={item}>{{count:'تعداد',sum:'مجموع',avg:'میانگین',min:'کمینه',max:'بیشینه'}[item]||item}</option>)}</select></label>
      {aggregate!=='count'&&<label style={{display:'grid',gap:6}}>شاخص عددی<select style={control} value={measure} onChange={e=>setMeasure(e.target.value)}>{numericFields.map(field=><option key={field.key} value={field.key}>{field.label}</option>)}</select></label>}
      <label style={{display:'grid',gap:6}}>از تاریخ<input style={control} type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label style={{display:'grid',gap:6}}>تا تاریخ<input style={control} type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
    </div>
    <div style={{marginTop:18}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap'}}><strong>فیلترها</strong><button type="button" style={button} disabled={!source||filters.length>=10} onClick={()=>setFilters(current=>[...current,{field:source?.fields.find(field=>field.filterable)?.key||'',operator:'eq',value:''}])}>افزودن شرط</button></div>
      {filters.map((filter,index)=><div key={index} style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,150px),1fr))',gap:8,marginTop:8}}>
        <select style={control} value={filter.field} onChange={e=>setFilters(current=>current.map((item,i)=>i===index?{...item,field:e.target.value}:item))}>{source?.fields.filter(field=>field.filterable).map(field=><option key={field.key} value={field.key}>{field.label}</option>)}</select>
        <select style={control} value={filter.operator} onChange={e=>setFilters(current=>current.map((item,i)=>i===index?{...item,operator:e.target.value}:item))}>{[['eq','برابر'],['neq','مخالف'],['contains','شامل عبارت'],['in','یکی از مقادیر (با ویرگول)'],['gte','بزرگ‌تر یا مساوی'],['lte','کوچک‌تر یا مساوی']].map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
        <input style={control} value={filter.value} placeholder={filter.operator==='in'?'مقادیر با ویرگول':'مقدار'} onChange={e=>setFilters(current=>current.map((item,i)=>i===index?{...item,value:e.target.value}:item))}/>
        <button type="button" style={button} onClick={()=>setFilters(current=>current.filter((_,i)=>i!==index))}>حذف شرط</button>
      </div>)}
    </div>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:18}}><button type="button" style={button} disabled={busy||!sourceKey||!organizationId||(aggregate!=='count'&&!measure)} onClick={()=>void run()}>{busy?'در حال پردازش…':'اجرای گزارش'}</button><button type="button" style={button} disabled={busy||!sourceKey||!organizationId} onClick={()=>void enqueueReport()}>اجرای پس‌زمینه</button><button type="button" style={button} onClick={()=>{setLoadedId('');setCanEdit(true);setTitle('');setDescription('');setIsShared(false);setResult(null);setFilters([]);setGroupBy('');setAggregate('count');setMeasure('')}}>گزارش جدید</button></div>
    <div style={{borderTop:'1px solid var(--border, #e5e7eb)',marginTop:20,paddingTop:18}}>
      <h3 style={{marginTop:0}}>اجرای پس‌زمینه و زمان‌بندی</h3>
      {jobId&&<div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:12}}><span>شناسه اجرا: {jobId.slice(0,8)} · وضعیت: {jobStatus}</span><button type="button" style={button} disabled={busy} onClick={()=>void refreshJob()}>به‌روزرسانی وضعیت</button></div>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,160px),1fr))',gap:8}}>
        <label style={{display:'grid',gap:5}}>تناوب<select style={control} value={frequency} onChange={e=>setFrequency(e.target.value)}><option value="DAILY">روزانه</option><option value="WEEKLY">هفتگی</option><option value="MONTHLY">ماهانه (روز اول)</option></select></label>
        {frequency==='WEEKLY'&&<label style={{display:'grid',gap:5}}>روز هفته<select style={control} value={weekday} onChange={e=>setWeekday(Number(e.target.value))}>{[['0','یکشنبه'],['1','دوشنبه'],['2','سه‌شنبه'],['3','چهارشنبه'],['4','پنجشنبه'],['5','جمعه'],['6','شنبه']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}
        <label style={{display:'grid',gap:5}}>ساعت ارسال<input style={control} type="time" value={scheduleTime} onChange={e=>setScheduleTime(e.target.value)}/></label>
      </div>
      <button type="button" style={{...button,marginTop:10}} disabled={busy||!organizationId} onClick={()=>void createSchedule()}>ثبت زمان‌بندی و ارسال ایمیل به حساب من</button>
      {!!schedules.length&&<div style={{display:'grid',gap:8,marginTop:12}}>{schedules.map(item=><div key={item.id} style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center',border:'1px solid var(--border, #e5e7eb)',borderRadius:9,padding:10}}><span>{item.frequency==='DAILY'?'روزانه':item.frequency==='WEEKLY'?'هفتگی':'ماهانه'} · {String(item.timeOfDay).slice(0,5)} · {item.isActive?'فعال':'متوقف'}</span><button type="button" style={button} disabled={busy} onClick={()=>void toggleSchedule(item)}>{item.isActive?'توقف':'فعال‌سازی'}</button></div>)}</div>}
    </div>
    <div style={{borderTop:'1px solid var(--border, #e5e7eb)',marginTop:20,paddingTop:18}}>
      <h3 style={{marginTop:0}}>ذخیره و اشتراک گزارش</h3>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,220px),1fr))',gap:10}}>
        <label style={{display:'grid',gap:5}}>عنوان گزارش<input style={control} value={title} onChange={e=>setTitle(e.target.value)} maxLength={160} placeholder="مثلاً وضعیت فرایندهای واحدها"/></label>
        <label style={{display:'grid',gap:5}}>توضیحات<input style={control} value={description} onChange={e=>setDescription(e.target.value)} maxLength={1000}/></label>
      </div>
      <label style={{display:'flex',alignItems:'center',gap:8,marginTop:10}}><input type="checkbox" checked={isShared} onChange={e=>setIsShared(e.target.checked)}/>اشتراک با مدیران مجاز همین مشتری</label>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}>{(!loadedId||canEdit)&&<button style={button} type="button" disabled={busy||!title.trim()} onClick={()=>void save()}>{loadedId?'به‌روزرسانی گزارش':'ذخیره گزارش'}</button>}<button style={button} type="button" disabled={busy||!loadedId} onClick={()=>void exportCsv()}>خروجی CSV</button></div>
    </div>
    <div style={{borderTop:'1px solid var(--border, #e5e7eb)',marginTop:20,paddingTop:18}}>
      <h3 style={{marginTop:0}}>گزارش‌های ذخیره‌شده</h3>
      {!saved.length&&<p style={{opacity:.7}}>هنوز گزارشی ذخیره نشده است.</p>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,230px),1fr))',gap:8}}>
        {saved.map(item=><article key={item.id} style={{border:'1px solid var(--border, #e5e7eb)',borderRadius:10,padding:12,minWidth:0}}>
          <strong>{item.title}</strong><div style={{fontSize:12,opacity:.7,margin:'5px 0 10px'}}>{item.isShared?'اشتراکی برای مشتری':'خصوصی'}{item.description?' · '+item.description:''}</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}><button type="button" style={button} disabled={busy} onClick={()=>void loadSaved(item.id)}>بازکردن و اجرا</button>{item.isOwner&&<button type="button" style={button} disabled={busy} onClick={()=>void removeSaved(item.id)}>حذف</button>}</div>
        </article>)}
      </div>
    </div>
    {result&&<div style={{borderTop:'1px solid var(--border, #e5e7eb)',marginTop:20,paddingTop:18}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap',alignItems:'center'}}><div><h3 style={{margin:'0 0 5px'}}>نتیجه گزارش: {result.sourceLabel}</h3><small style={{opacity:.7}}>از {new Date(result.period.from).toLocaleDateString('fa-IR')} تا {new Date(result.period.to).toLocaleDateString('fa-IR')} · {result.rowCount.toLocaleString('fa-IR')} ردیف</small></div></div>
      <div style={{display:'grid',gap:9,marginTop:14}}>{result.rows.slice(0,20).map((row,index)=><div key={index} style={{display:'grid',gridTemplateColumns:'minmax(90px,1fr) minmax(80px,2fr) auto',alignItems:'center',gap:10}}><span style={{overflowWrap:'anywhere'}}>{row.dimension??'کل'}</span><div style={{height:12,background:'var(--muted, #eef2f6)',borderRadius:20,overflow:'hidden'}}><div style={{height:'100%',width:(Math.max(0,Math.min(100,Math.abs(row.value||0)/maxValue*100)))+'%',background:'var(--accent, #4776c7)',borderRadius:20}}/></div><strong>{row.value===null?'—':row.value.toLocaleString('fa-IR',{maximumFractionDigits:2})}</strong></div>)}</div>
      <div style={{overflowX:'auto',marginTop:16}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:360}}><thead><tr>{[result.groupLabel||'گروه',result.measureLabel].map(label=><th key={label} style={{textAlign:'right',padding:10,borderBottom:'1px solid var(--border, #e5e7eb)'}}>{label}</th>)}</tr></thead><tbody>{result.rows.map((row,index)=><tr key={index}><td style={{padding:10,borderBottom:'1px solid var(--border, #e5e7eb)'}}>{row.dimension??'کل'}</td><td style={{padding:10,borderBottom:'1px solid var(--border, #e5e7eb)'}}>{row.value===null?'—':row.value.toLocaleString('fa-IR',{maximumFractionDigits:2})}</td></tr>)}</tbody></table></div>
    </div>}
  </section>;
}
