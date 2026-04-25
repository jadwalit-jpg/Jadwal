import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Decode JWT payload without verification (Edge runtime can't use the full
 * jsonwebtoken library). This is safe because:
 * 1. The backend verifies the signature on every API call
 * 2. This is only used for routing decisions (which page to show), not authorization
 * 3. A tampered token will fail on the next API call and the user gets logged out
 */
function decodeJwtPayload(token: string): { role?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // base64url → base64 conversion for proper JWT decoding
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    return payload;
  } catch {
    return null;
  }
}

// ─── API origin for CSP connect-src ───────────────────────────
// NEXT_PUBLIC_API_URL is required; we can't throw at module load here
// (Edge runtime) so we fall back to 'self' which is safe but restrictive.
const API_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL!).origin;
  } catch {
    return "'self'";
  }
})();

const IMG_HOSTS = [
  "'self'",
  'blob:',
  'data:',
  'https://*.tile.openstreetmap.org',
  'https://unpkg.com',
  'https://jadwal-assets.s3.amazonaws.com',
  'https://jadwal-assets.s3.me-south-1.amazonaws.com',
  'https://cdn.jadwal.app',
  API_ORIGIN,
];

const FRAME_HOSTS = ['https://maps.google.com', 'https://www.google.com'];

/**
 * Build a per-request CSP with a cryptographic nonce.
 *
 * Why nonce + `strict-dynamic`:
 * - `'unsafe-inline'` in script-src turns any stored-XSS point (vendor name,
 *   activity description, review text) into a full JS execution primitive
 *   → attacker can redirect the page to a porn-ad site, inject ad iframes,
 *   exfiltrate cookies, etc.
 * - Nonce-based CSP only lets scripts carrying *this* request's nonce run.
 * - `'strict-dynamic'` lets the nonce-trusted bootstrap script load further
 *   scripts (needed by Next.js's runtime).
 * - `img-src` is pinned to our own hosts + S3/CDN — no bare `https:` wildcard,
 *   so an injected `<img src="http://tracker.evil/">` can't beacon out.
 */
function buildCsp(nonce: string, isProd: boolean): string {
  const scriptSrc = isProd
    ? `'self' 'nonce-${nonce}' 'strict-dynamic'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`; // unsafe-eval for React Fast Refresh in dev only

  // Optional report-uri — if CSP_REPORT_URI is set, the browser posts
  // every blocked-resource event there so real-world injection attempts
  // are visible. Point it at Sentry / report-uri.com / Cloudflare / a
  // self-hosted collector.
  const reportUri = process.env.NEXT_PUBLIC_CSP_REPORT_URI?.trim();

  const directives = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`, // styled-jsx / Tailwind JIT need inline styles
    `img-src ${IMG_HOSTS.join(' ')}`,
    `connect-src 'self' ${API_ORIGIN} https://nominatim.openstreetmap.org${reportUri ? ' ' + new URL(reportUri).origin : ''}`,
    `font-src 'self' data:`,
    `frame-src ${FRAME_HOSTS.join(' ')}`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `upgrade-insecure-requests`,
  ];

  if (reportUri) directives.push(`report-uri ${reportUri}`);
  return directives.join('; ');
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ─── Per-request CSP nonce ──────────────────────────────────
  // 16 random bytes → base64. Next.js automatically propagates the nonce
  // from the `x-nonce` request header to every <script> tag it emits.
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
  const isProd = process.env.NODE_ENV === 'production';
  const csp = buildCsp(nonce, isProd);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const applyCspHeaders = (res: NextResponse) => {
    res.headers.set('Content-Security-Policy', csp);
    return res;
  };

  const authCookie = request.cookies.get('Authentication');
  const isAuthenticated = !!authCookie?.value;
  const payload = authCookie?.value ? decodeJwtPayload(authCookie.value) : null;
  const role = payload?.role;

  // ─── Admin Routes ─────────────────────────────────────────
  if (pathname.startsWith('/admin')) {
    if (pathname === '/admin/login') {
      if (isAuthenticated && role === 'ADMIN') {
        return applyCspHeaders(NextResponse.redirect(new URL('/admin/dashboard', request.url)));
      }
      return applyCspHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
    }

    if (!isAuthenticated) {
      return applyCspHeaders(NextResponse.redirect(new URL('/admin/login', request.url)));
    }

    if (role !== 'ADMIN') {
      return applyCspHeaders(NextResponse.redirect(new URL('/', request.url)));
    }

    return applyCspHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  // ─── Vendor Routes ────────────────────────────────────────
  if (pathname.startsWith('/vendor')) {
    if (!isAuthenticated) {
      return applyCspHeaders(NextResponse.redirect(new URL('/register/vendor', request.url)));
    }
    if (role !== 'VENDOR') {
      return applyCspHeaders(NextResponse.redirect(new URL('/', request.url)));
    }
    return applyCspHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  // ─── Customer Protected Routes ─────────────────────────────
  const customerProtectedPaths = ['/bookings', '/profile', '/my-account', '/cart', '/favorites'];
  if (customerProtectedPaths.some((p) => pathname.startsWith(p))) {
    if (!isAuthenticated) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('callbackUrl', pathname);
      return applyCspHeaders(NextResponse.redirect(loginUrl));
    }
    return applyCspHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  // ─── Login page — redirect if already authenticated ───────
  if (pathname === '/login' && isAuthenticated) {
    const raw = request.nextUrl.searchParams.get('callbackUrl') ?? '';
    // Only pure relative paths — block open redirect (protocol-relative,
    // backslash-normalised, or any colon/backslash).
    const safe =
      raw.startsWith('/') &&
      !raw.startsWith('//') &&
      !raw.startsWith('/\\') &&
      !raw.includes(':') &&
      !raw.includes('\\')
        ? raw
        : '/';
    return applyCspHeaders(NextResponse.redirect(new URL(safe, request.url)));
  }

  return applyCspHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  // Run on every request except Next.js internals and static assets.
  // CSP must be set on HTML responses; excluding _next/static/_next/image/favicon
  // avoids unnecessary middleware overhead on asset fetches.
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff|woff2|ttf|eot)).*)',
    },
  ],
};
