"use client";

import { useCallback, useEffect, useState } from "react";

const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api").replace(/\/$/, "");
type Organization = { id: string; name: string; code: string };
type Unit = { id: string; name: string; code: string; parentId: string | null; isActive: boolean };
type Position = { id: string; title: string; code: string; isActive: boolean };

export default function OrganizationStructurePage() {
  const [token, setToken] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState("");
  const [positions, setPositions] = useState<Position[]>([]);
  const [unitName, setUnitName] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [parentId, setParentId] = useState("");
  const [positionTitle, setPositionTitle] = useState("");
  const [positionCode, setPositionCode] = useState("");
  const [originalUserId, setOriginalUserId] = useState("");
  const [substituteUserId, setSubstituteUserId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const headers = useCallback((json = false): Record<string, string> => ({
    Authorization: "Bearer " + token,
    ...(tenantId ? { "X-Tenant-Id": tenantId } : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
  }), [token, tenantId]);

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(API + path, { ...init, headers: headers(init.body !== undefined), cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.message || "درخواست ناموفق بود");
    return body;
  }, [headers]);

  const loadUnits = useCallback(async (orgId = organizationId) => {
    if (!orgId) { setUnits([]); setPositions([]); return; }
    const rows = await api("/organizations/" + orgId + "/units");
    setUnits(Array.isArray(rows) ? rows : []);
    setUnitId("");
    setPositions([]);
  }, [api, organizationId]);

  const loadPositions = useCallback(async (id = unitId) => {
    if (!id) { setPositions([]); return; }
    const rows = await api("/organizations/units/" + id + "/positions");
    setPositions(Array.isArray(rows) ? rows : []);
  }, [api, unitId]);

  useEffect(() => {
    const t = localStorage.getItem("fsb.accessToken") || "";
    const tenant = localStorage.getItem("fsb.tenantId") || "";
    setToken(t); setTenantId(tenant);
    if (!t) return;
    void (async () => {
      try {
        const rows = await api("/organizations/accessible");
        const list = Array.isArray(rows) ? rows as Organization[] : [];
        setOrganizations(list);
        const stored = localStorage.getItem("fsb.organizationId") || "";
        const selected = list.some(item => item.id === stored) ? stored : (list[0]?.id || "");
        setOrganizationId(selected);
      } catch (e) { setError(e instanceof Error ? e.message : "دریافت سازمان‌ها ناموفق بود"); }
    })();
  }, [api]);

  useEffect(() => { if (organizationId) { localStorage.setItem("fsb.organizationId", organizationId); void loadUnits(organizationId).catch(e => setError(e instanceof Error ? e.message : "خطا")); } }, [organizationId, loadUnits]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(success); }
    catch (e) { setError(e instanceof Error ? e.message : "عملیات ناموفق بود"); }
    finally { setBusy(false); }
  }

  async function createUnit(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api("/organizations/units", { method: "POST", body: JSON.stringify({
        organizationId, name: unitName.trim(), code: unitCode.trim(), parentId: parentId || undefined,
      }) });
      setUnitName(""); setUnitCode(""); setParentId("");
      await loadUnits(organizationId);
    }, "واحد سازمانی ایجاد شد.");
  }

  async function createPosition(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api("/organizations/positions", { method: "POST", body: JSON.stringify({
        organizationUnitId: unitId, title: positionTitle.trim(), code: positionCode.trim(),
      }) });
      setPositionTitle(""); setPositionCode("");
      await loadPositions(unitId);
    }, "سمت سازمانی ایجاد شد.");
  }

  async function createSubstitution(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api("/workflow/organization-substitutions", { method: "POST", body: JSON.stringify({
        organizationId, originalUserId, substituteUserId,
        startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), reason: reason.trim(),
      }) });
      setOriginalUserId(""); setSubstituteUserId(""); setStartsAt(""); setEndsAt(""); setReason("");
    }, "جانشینی زمان‌بندی‌شده ثبت شد.");
  }

  const input: React.CSSProperties = { width: "100%", padding: 10, border: "1px solid #d0d5dd", borderRadius: 8, font: "inherit" };
  const panel: React.CSSProperties = { background: "var(--panel, #fff)", border: "1px solid #e4e8f0", borderRadius: 14, padding: 18, minWidth: 0 };
  const button: React.CSSProperties = { padding: "9px 14px", border: "1px solid #cbd5e1", borderRadius: 8, background: "#fff", cursor: "pointer", font: "inherit" };

  if (!token) return <main dir="rtl" style={{ maxWidth: 620, margin: "48px auto", padding: 24, ...panel }}>
    <h1>ساختار سازمانی</h1><p>ابتدا در سامانه وارد شوید تا سازمان‌های مجاز نمایش داده شوند.</p>
    <a href="/login">رفتن به ورود</a>
  </main>;

  return <main dir="rtl" style={{ maxWidth: 1180, margin: "0 auto", padding: 24, display: "grid", gap: 18 }}>
    <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div><p style={{ color: "#667085", marginBottom: 4 }}>F-S / ORGANIZATION</p><h1 style={{ margin: 0 }}>ساختار و چارت سازمانی</h1><p>مدیریت سلسله‌مراتب واحدها، سمت‌ها و جانشینی موقت</p></div>
      <nav style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><a href="/organization-dashboard" style={button}>داشبورد سازمان</a><a href="/absences" style={button}>غیبت‌ها</a></nav>
    </header>
    {error && <p role="alert" style={{ color: "#b42318", background: "#fef3f2", padding: 12, borderRadius: 8 }}>{error}</p>}
    {notice && <p role="status" style={{ color: "#067647", background: "#ecfdf3", padding: 12, borderRadius: 8 }}>{notice}</p>}
    <section style={panel}>
      <label>سازمان فعال</label>
      <select style={input} value={organizationId} onChange={e => setOrganizationId(e.target.value)}>
        <option value="">انتخاب سازمان مجاز</option>
        {organizations.map(org => <option key={org.id} value={org.id}>{org.name} · {org.code}</option>)}
      </select>
      {!organizations.length && <p>سازمانی در دامنه دسترسی شما نیست یا مجوز خواندن سازمان ندارید.</p>}
    </section>
    <section style={{ display: "grid", gridTemplateColumns: "minmax(260px,.8fr) minmax(0,1.2fr)", gap: 18, alignItems: "start" }}>
      <div style={{ display: "grid", gap: 18 }}>
        <section style={panel}>
          <h2>ایجاد واحد</h2>
          <form onSubmit={createUnit} style={{ display: "grid", gap: 10 }}>
            <input style={input} placeholder="نام واحد" value={unitName} onChange={e => setUnitName(e.target.value)} minLength={2} maxLength={160} required />
            <input style={input} placeholder="کد لاتین واحد (مثلاً FINANCE)" value={unitCode} onChange={e => setUnitCode(e.target.value)} pattern="[A-Za-z0-9_-]{2,80}" required />
            <label>واحد بالادست (برای ساختار تو در تو)</label>
            <select style={input} value={parentId} onChange={e => setParentId(e.target.value)}><option value="">واحد ریشه</option>{units.filter(unit => unit.isActive).map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select>
            <button style={button} disabled={busy || !organizationId}>ثبت واحد</button>
          </form>
        </section>
        <section style={panel}>
          <h2>ساختار واحدها</h2>
          {units.length === 0 && <p>هنوز واحدی برای این سازمان ثبت نشده است.</p>}
          <div style={{ display: "grid", gap: 8 }}>
            {units.map(unit => <button key={unit.id} onClick={() => { setUnitId(unit.id); void loadPositions(unit.id).catch(e => setError(e instanceof Error ? e.message : "خطا")); }} style={{ ...button, textAlign: "right", borderColor: unitId === unit.id ? "#2563eb" : "#d0d5dd", opacity: unit.isActive ? 1 : .6 }}>
              <strong>{unit.name}</strong><div style={{ fontSize: 12, color: "#667085" }}>{unit.code} · {unit.parentId ? "زیرواحد" : "واحد ریشه"} · {unit.isActive ? "فعال" : "غیرفعال"}</div>
            </button>)}
          </div>
        </section>
      </div>
      <div style={{ display: "grid", gap: 18 }}>
        <section style={panel}>
          <h2>سمت‌های واحد</h2>
          {unitId ? <><p>واحد انتخاب‌شده: {units.find(u => u.id === unitId)?.name}</p>
            <form onSubmit={createPosition} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8 }}>
              <input style={input} placeholder="عنوان سمت" value={positionTitle} onChange={e => setPositionTitle(e.target.value)} minLength={2} maxLength={160} required />
              <input style={input} placeholder="کد سمت" value={positionCode} onChange={e => setPositionCode(e.target.value)} pattern="[A-Za-z0-9_-]{2,80}" required />
              <button style={button} disabled={busy}>افزودن</button>
            </form>
            <div style={{ overflowX: "auto", marginTop: 14 }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th style={{ textAlign: "right", padding: 8 }}>عنوان سمت</th><th style={{ textAlign: "right", padding: 8 }}>کد</th><th style={{ textAlign: "right", padding: 8 }}>وضعیت</th></tr></thead><tbody>{positions.map(position => <tr key={position.id}><td style={{ padding: 8, borderTop: "1px solid #eee" }}>{position.title}</td><td style={{ padding: 8, borderTop: "1px solid #eee" }}>{position.code}</td><td style={{ padding: 8, borderTop: "1px solid #eee" }}>{position.isActive ? "فعال" : "غیرفعال"}</td></tr>)}</tbody></table></div>
          </> : <p>برای مشاهده سمت‌ها، یک واحد را انتخاب کنید.</p>}
        </section>
        <section style={panel}>
          <h2>ثبت جانشینی موقت</h2>
          <p>شناسه کاربران باید متعلق به اعضای فعال همین Tenant و سازمان باشد؛ API این موضوع را مجدداً بررسی می‌کند.</p>
          <form onSubmit={createSubstitution} style={{ display: "grid", gap: 9 }}>
            <input style={input} placeholder="UUID کاربر اصلی" value={originalUserId} onChange={e => setOriginalUserId(e.target.value)} required />
            <input style={input} placeholder="UUID جانشین" value={substituteUserId} onChange={e => setSubstituteUserId(e.target.value)} required />
            <label>شروع <input style={input} type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} required /></label>
            <label>پایان <input style={input} type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} required /></label>
            <textarea style={input} placeholder="دلیل جانشینی (حداقل ۵ نویسه)" value={reason} onChange={e => setReason(e.target.value)} minLength={5} maxLength={1000} required />
            <button style={button} disabled={busy || !organizationId}>ثبت جانشینی</button>
          </form>
        </section>
      </div>
    </section>
  </main>;
}
