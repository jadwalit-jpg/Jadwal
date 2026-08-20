import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { LANG_COOKIE, LANG_HEADER } from './lib/lang-cookie';
import { hasArPrefix, isLocalizablePath, localePath, stripLocalePrefix } from './lib/locale-path';

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
// CSP needs an origin we can name in img-src / connect-src. Two cases:
//   1) NEXT_PUBLIC_API_URL is absolute (legacy: "http://api.example.com/api")
//      → use its origin.
//   2) NEXT_PUBLIC_API_URL is relative ("/api") because we proxy through
//      Next.js — same-origin already covers /api/* and /uploads/*, so
//      'self' is enough. We DO still need to allow the raw API origin
//      for any historical absolute URLs that may live in the DB; pass
//      it via API_PROXY_TARGET (server-side env, no client leak).
const API_ORIGIN = (() => {
  const candidates = [process.env.NEXT_PUBLIC_API_URL, process.env.API_PROXY_TARGET];
  for (const c of candidates) {
    if (!c) continue;
    try {
      return new URL(c).origin;
    } catch {
      // not absolute, try next
    }
  }
  return "'self'";
})();

// CDN_URL is a build-time injection (NEXT_PUBLIC_*) so it can be switched via
// the web task definition without code edits. Falls back to no extra host when
// unset (dev / no-CDN deploys); production sets it to the CloudFront domain.
// Normalize to scheme+host only — a misconfigured value with trailing slash
// or path (e.g. "https://cdn.example.com/uploads/") would corrupt CSP if
// injected verbatim.
const CDN_HOST = (() => {
  const raw = process.env.NEXT_PUBLIC_CDN_URL?.trim();
  if (!raw) return undefined;
  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
})();

const IMG_HOSTS = [
  "'self'",
  'blob:',
  'data:',
  'https://*.tile.openstreetmap.org',
  'https://unpkg.com',
  'https://jadwal-assets.s3.amazonaws.com',
  'https://jadwal-assets.s3.eu-central-1.amazonaws.com',
  'https://cdn.jadwal.qa',
  // Meta Pixel image beacons (fbevents.js posts tracking to facebook.com/tr).
  // The pixel loads ONLY after cookie consent — see components/meta-pixel.tsx.
  'https://www.facebook.com',
  // Google Ads (gtag.js) conversion + remarketing image beacons. gtag.js is
  // loaded via 'strict-dynamic' (no script-src entry needed); only its beacon
  // hosts need allowlisting. Loads under the SAME opt-out cookie consent as the
  // Meta Pixel — see components/google-tag.tsx.
  'https://www.googletagmanager.com',
  'https://www.google.com',
  'https://www.googleadservices.com',
  'https://googleads.g.doubleclick.net',
  // Microsoft Clarity beacons. clarity.ms/tag loads via 'strict-dynamic' (no
  // script-src entry needed); it uploads replay data to per-region subdomains
  // (c.clarity.ms, x.clarity.ms, ...), hence the wildcard. Loads under the SAME
  // opt-out consent and is blocked outright on checkout/account routes — see
  // components/clarity.tsx.
  'https://*.clarity.ms',
  'https://c.bing.com',
  // Build-time CDN host (NEXT_PUBLIC_CDN_URL). Add to the allowlist ONLY if
  // it differs from the hardcoded production fallback above — prevents the
  // duplicate `cdn.jadwal.qa cdn.jadwal.qa` entry that the live CSP header
  // showed before this dedupe. The hardcoded line stays as a safety net so
  // production never silently loses CDN images if the env var is dropped
  // from the next deploy.
  ...(CDN_HOST && CDN_HOST !== 'https://cdn.jadwal.qa' ? [CDN_HOST] : []),
  API_ORIGIN,
];

const FRAME_HOSTS = ['https://www.google.com'];

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
    // Tailwind v4 inlines critical CSS at build time, so 'unsafe-inline' on
    // style-src is required for first paint. The project does NOT use
    // styled-jsx; only Tailwind. The risk profile is style-only — an
    // attacker controlling inline styles cannot execute scripts because
    // script-src above is nonce-based with NO 'unsafe-inline'.
    `style-src 'self' 'unsafe-inline'`,
    `img-src ${IMG_HOSTS.join(' ')}`,
    // Meta Pixel: fbevents.js is fetched from connect.facebook.net and beacons
    // to www.facebook.com (only after cookie consent — see MetaPixel).
    // Google Ads: gtag.js (googletagmanager.com) beacons conversions to
    // google.com / googleadservices.com / doubleclick (Ads + GA4 share one
    // gtag.js). Clarity uploads session replays to *.clarity.ms + c.bing.com,
    // same consent, and is never loaded on checkout/account routes — same opt-out consent.
    `connect-src 'self' ${API_ORIGIN} https://nominatim.openstreetmap.org https://www.facebook.com https://connect.facebook.net https://www.googletagmanager.com https://www.google.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://*.clarity.ms https://c.bing.com${reportUri ? ' ' + new URL(reportUri).origin : ''}`,
    `font-src 'self' data:`,
    `frame-src ${FRAME_HOSTS.join(' ')}`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    // 'self' for normal in-app form posts + the PAY2M hosted-checkout host:
    // the booking page auto-submits a form to
    // https://pay.pay2m.com/Ecommerce/api/Transaction/PostTransaction.
    // Host-level (no path) so it matches the PostTransaction endpoint and any
    // future PAY2M path. Mirrors the API Helmet CSP (main.ts) and the runtime
    // allowlist in lib/pay2m.ts. Removing pay.pay2m.com here silently breaks
    // checkout — the browser blocks the form POST.
    `form-action 'self' https://pay.pay2m.com`,
    // upgrade-insecure-requests is a hard "force HTTPS" instruction.
    // On http://localhost it breaks every request (no TLS = SSL connect
    // error on WebKit/iOS). Only emit it when we know we're behind real
    // TLS — gated on the same ENABLE_HSTS env var as the HSTS header
    // (CloudFront / ALB sets it).
    ...(process.env.ENABLE_HSTS === 'true' ? [`upgrade-insecure-requests`] : []),
  ];

  if (reportUri) directives.push(`report-uri ${reportUri}`);
  return directives.join('; ');
}

// ─── Kill switch (Z.144) ───────────────────────────────────────────
// When `LAUNCH_DISABLED=true` is set on the web task, every public route
// redirects to `/maintenance` (the holding page). Staff routes (/admin/*,
// /vendor/*) and auth routes stay reachable so support + engineering
// can log in and investigate. /api/* is already excluded from this
// middleware via the matcher config below, so the backend keeps running
// unchanged.
//
// Activation procedure (~3-5 min from flip to all-users-blocked):
//   1. Edit infra/ecs/web-task.json → set LAUNCH_DISABLED to "true",
//      register a new task-def revision, force-new-deployment on the
//      jadwal-web service.
//   OR (faster, no code change):
//   1. ECS console → jadwal-web → Update service → Force new deployment
//      with a task-def revision that overrides LAUNCH_DISABLED=true.
//
// Defaults to "off" — the env var is missing in the task-def baseline,
// so removing the flag (typo, deleted) keeps the site live, not the
// other way around.
const LAUNCH_DISABLED = process.env.LAUNCH_DISABLED === 'true';

// Path prefixes/exact paths that stay reachable when the kill switch
// is on. Order doesn't matter; the check is `some(prefix)`. /api/* is
// excluded from middleware entirely via the matcher config (no entry
// needed here).
const KILL_SWITCH_ALLOWED_PREFIXES = [
  '/admin',
  '/vendor',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
];

function isAllowedDuringKillswitch(pathname: string): boolean {
  if (pathname === '/maintenance') return true; // the holding page itself
  return KILL_SWITCH_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
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

    // ─── / (home) browser-only cache ───────────────────────────
    // / renders a per-request geo-aware eyebrow ("Qatar · Local
    // experiences" via CF-IPCountry). Edge caching shares one HTML across
    // all visitors → first cache populator's country leaks to everyone.
    //
    // `private` keeps the response in the visitor's browser cache only —
    // never the CF edge or any shared cache. Each user's first visit hits
    // origin (~200-400ms) but repeats within 5 min serve from local cache
    // (~0ms). No cross-user contamination is structurally possible.
    //
    // `must-revalidate` blocks stale-while-error serving past the TTL.
    //
    // CSP nonce safety: the browser caches headers + body atomically, so
    // the cached `<script nonce="X">` always matches the cached CSP
    // header's `nonce-X` directive. No re-stamping needed.
    if (pathname === '/') {
      res.headers.set('Cache-Control', 'private, max-age=300, must-revalidate');
    }

    return res;
  };

  // ─── Kill switch — runs before any auth / route logic ───────
  if (LAUNCH_DISABLED && !isAllowedDuringKillswitch(pathname)) {
    return applyCspHeaders(NextResponse.redirect(new URL('/maintenance', request.url)));
  }

  // ─── Bilingual /ar locale routing (PUBLIC routes only) ───────
  // English is unprefixed; Arabic is served under /ar/* via an internal REWRITE
  // (the browser URL stays /ar/..., the underlying public route renders in
  // Arabic via the x-lang header). The cookie is a *preference*: a returning
  // Arabic user landing on an unprefixed public URL is redirected to its /ar
  // twin. Crawlers send no cookie → they always get English at the root URL,
  // so English rankings are untouched. Non-public routes (admin/vendor/auth/
  // per-user) fall through to the auth logic below and stay cookie-driven.
  const cookieLang = request.cookies.get(LANG_COOKIE)?.value;

  if (hasArPrefix(pathname)) {
    const { path: underlying } = stripLocalePrefix(pathname);
    if (!isLocalizablePath(underlying)) {
      // /ar may only wrap public routes — strip the prefix off a non-public path.
      const stripped = request.nextUrl.clone();
      stripped.pathname = underlying;
      return applyCspHeaders(NextResponse.redirect(stripped));
    }
    requestHeaders.set(LANG_HEADER, 'ar');
    const rewritten = request.nextUrl.clone();
    rewritten.pathname = underlying; // search params preserved by clone()
    return applyCspHeaders(NextResponse.rewrite(rewritten, { request: { headers: requestHeaders } }));
  }

  if (isLocalizablePath(pathname)) {
    if (cookieLang === 'ar') {
      const target = request.nextUrl.clone();
      target.pathname = localePath(pathname, 'ar');
      return applyCspHeaders(NextResponse.redirect(target));
    }
    requestHeaders.set(LANG_HEADER, 'en'); // public unprefixed = English; tell SSR explicitly
    return applyCspHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
  }
  // else: non-localizable (admin/vendor/auth/per-user) → fall through; language
  // stays cookie-driven (LANG_HEADER intentionally not set).

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
  // Match exact path OR a `/<path>/...` sub-route — same pattern as
  // `isAllowedDuringKillswitch()` above. Plain `startsWith(p)` would
  // accidentally gate hypothetical future routes like `/bookings-survey`
  // that share a prefix with a protected route; the explicit `=== p` /
  // `p + '/'` test rules that out.
  const customerProtectedPaths = ['/bookings', '/profile', '/my-account', '/cart', '/favorites', '/notifications', '/likes', '/account'];
  if (customerProtectedPaths.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
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
