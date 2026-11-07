import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'F-S | BPMS', description: 'سامانه مدیریت فرایندهای سازمانی' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="fa" dir="rtl"><body>{children}</body></html>; }
