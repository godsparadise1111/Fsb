'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { STORAGE, getAccessToken, installAuthFetch, isPublicPath, redirectToLogin } from '../lib/auth';

/** Mounted once in the root layout: silent token refresh for every page and a guard for signed-out visitors. */
export default function AuthBootstrap() {
  const pathname = usePathname();

  useEffect(() => { installAuthFetch(); }, []);

  useEffect(() => {
    if (!isPublicPath(pathname) && !getAccessToken()) redirectToLogin();
  }, [pathname]);

  useEffect(() => {
    // Signing out in one tab signs out all tabs.
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE.access && !event.newValue) redirectToLogin();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return null;
}
