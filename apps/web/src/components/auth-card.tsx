import type { CSSProperties, ReactNode } from 'react';

export const fieldStyle: CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d0d5dd', font: 'inherit', boxSizing: 'border-box' };
export const buttonStyle: CSSProperties = { padding: '10px 16px', borderRadius: 8, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer', font: 'inherit' };
export const primaryButtonStyle: CSSProperties = { ...buttonStyle, background: '#1d4ed8', borderColor: '#1d4ed8', color: '#fff' };
export const dangerButtonStyle: CSSProperties = { ...buttonStyle, color: '#b42318', borderColor: '#fda29b' };

export function AuthCard({ title, subtitle, children, wide }: { title: string; subtitle?: string; children: ReactNode; wide?: boolean }) {
  return (
    <main dir="rtl" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <section style={{ width: '100%', maxWidth: wide ? 760 : 420, background: '#fff', border: '1px solid #e4e8f0', borderRadius: 16, padding: 28, color: '#101828' }}>
        <a href="/" style={{ textDecoration: 'none', color: '#1d4ed8', fontWeight: 700 }}>F-S</a>
        <h1 style={{ margin: '10px 0 6px', fontSize: 22 }}>{title}</h1>
        {subtitle && <p style={{ margin: '0 0 18px', color: '#667085' }}>{subtitle}</p>}
        {children}
      </section>
    </main>
  );
}

export function Message({ kind, children }: { kind: 'error' | 'success'; children: ReactNode }) {
  const palette = kind === 'error' ? { color: '#b42318', background: '#fef3f2' } : { color: '#067647', background: '#ecfdf3' };
  return <p role={kind === 'error' ? 'alert' : 'status'} style={{ ...palette, padding: '10px 12px', borderRadius: 8, margin: '12px 0' }}>{children}</p>;
}
