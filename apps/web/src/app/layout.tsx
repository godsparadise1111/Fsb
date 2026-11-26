import type { Metadata } from 'next';
import '@fontsource-variable/vazirmatn';
import './globals.css';
import ThemeControl from '../components/theme-control';
import AuthBootstrap from '../components/auth-bootstrap';

export const metadata: Metadata = {
  title: 'F-S | BPMS',
  description: 'سامانه مدیریت فرایندهای سازمانی',
  applicationName: 'F-S',
  themeColor: '#172554',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body>
        {children}
        <AuthBootstrap />
        <ThemeControl />
      </body>
    </html>
  );
}
