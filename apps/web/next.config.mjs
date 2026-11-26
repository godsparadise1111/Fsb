const isProduction = process.env.NODE_ENV === 'production';

// The browser may only talk to this site and to the F-S API origin that was baked into the build.
let apiOrigin = '';
try {
  if (process.env.NEXT_PUBLIC_API_URL) apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL).origin;
} catch {
  apiOrigin = '';
}

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts; a nonce-based policy needs middleware and is a later hardening step.
  `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${apiOrigin ? ' ' + apiOrigin : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const baseHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Browsers ignore HSTS over plain HTTP, so this is harmless until the site is served over HTTPS.
  { key: 'Strict-Transport-Security', value: 'max-age=15552000' },
  ...(isProduction ? [{ key: 'Content-Security-Policy', value: contentSecurityPolicy }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: baseHeaders },
      {
        // Pages that handle credentials or one-time tokens must never be cached or leak their URL.
        source: '/:page(login|forgot-password|reset-password)',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
      { source: '/account/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};

export default nextConfig;
