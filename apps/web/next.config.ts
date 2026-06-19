import type { NextConfig } from "next";
import { resolve } from "path";

// NEXT_PUBLIC_API_URL is required — dev reads it from apps/web/.env,
// production reads it from the CI/Docker build arg. No fallbacks.
if (!process.env.NEXT_PUBLIC_API_URL) {
  throw new Error("[FATAL] NEXT_PUBLIC_API_URL must be set. Dev: check apps/web/.env. Prod: check CI build args.");
}

// NOTE: Content-Security-Policy is emitted by middleware.ts with a per-request
// nonce. Keeping CSP out of next.config.ts headers() avoids shipping a static
// CSP with 'unsafe-inline' — a stored-XSS-to-redirect amplifier.

// Same-origin proxy target for /api/*. Lets the browser see auth cookies
// as same-origin (works around WebKit/ITP dropping cross-port cookies)
// without leaking ports into client bundles. Always resolves on the
// SERVER side; never ships to the client bundle.
//
// Dev: defaults to the local API container.
// Prod: REQUIRED. We refuse to start without an explicit value so a
// misconfigured deploy can't silently route /api/* into a void
// (e.g. forwarding to localhost:4000 inside the container, where
// nothing listens, every request 404s, but the page still renders).
const API_PROXY_TARGET = (() => {
  if (process.env.API_PROXY_TARGET) return process.env.API_PROXY_TARGET;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[FATAL] API_PROXY_TARGET must be set in production. " +
        "Set it on the ECS task definition / docker-compose env. " +
        'Example: API_PROXY_TARGET="http://api.internal:4000/api"',
    );
  }
  return "http://localhost:4000/api";
})();

// Uploads proxy target — bare API origin (without `/api`) so we can route
// /uploads/* to the API server's /uploads/* endpoint. Same-origin = passes
// the strict img-src 'self' CSP without leaking the API host into client
// code. Derived from API_PROXY_TARGET; if that's malformed, fail loud in
// production rather than silently breaking image loads.
const UPLOADS_PROXY_TARGET = (() => {
  try {
    return new URL(API_PROXY_TARGET).origin;
  } catch {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[FATAL] API_PROXY_TARGET is not a valid absolute URL: " +
          `"${API_PROXY_TARGET}". Cannot derive UPLOADS_PROXY_TARGET.`,
      );
    }
    return "http://localhost:4000";
  }
})();

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(__dirname, "../../"),
  // Per-import code-splitting / tree-shaking for these barrel-ish packages so
  // a page that only uses one icon / one `motion` component doesn't pull the
  // whole library into its first-load JS. (framer-motion is the big one — see
  // also: it's been removed from the always-loaded navbar/notification-bell/
  // custom-select/animated-counter so it's no longer in the shared chunk.)
  experimental: {
    optimizePackageImports: ["framer-motion", "lucide-react", "date-fns"],
  },
  // Strip `X-Powered-By: Next.js` header. ZAP baseline flagged it as a
  // low-risk software-version disclosure; removing it makes drive-by
  // scanners' job marginally harder.
  poweredByHeader: false,
  async redirects() {
    return [
      // ── Canonical host: www → apex (301) ──
      // SEO tools flagged that www.jadwal.qa and jadwal.qa both resolve
      // without redirect (duplicate-content risk). Force the apex as the
      // single canonical host. Only fires for the literal www host, so
      // local dev (localhost) and the apex itself are untouched.
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.jadwal.qa" }],
        destination: "https://jadwal.qa/:path*",
        permanent: true,
      },
      // ── Launch swap: legacy /home → canonical apex (301) ──
      // The marketplace homepage moved from /home to / at launch
      // (2026-06-04). /home was already indexed, so 301 it to the apex to
      // consolidate ranking signals and avoid duplicate content.
      { source: "/home", destination: "/", permanent: true },
      // ── Legacy Shopify URL equity recovery (301) ──
      // The old store lived on Shopify with /collections/* and /products/*
      // (and /ar/* mirrors). ~900 backlinks still point there. The new
      // Next.js app has NO such routes (verified — they'd 404), so we
      // 301 them to the closest live page to preserve link equity.
      { source: "/collections/:path*", destination: "/explore", permanent: true },
      { source: "/products/:path*", destination: "/explore", permanent: true },
      { source: "/ar/collections/:path*", destination: "/ar/explore", permanent: true },
      { source: "/ar/products/:path*", destination: "/ar/explore", permanent: true },
      // NOTE: the old catch-all `"/ar/:path* → /"` (+ `"/ar → /"`) was REMOVED
      // here — `/ar` is now a VALID Arabic locale prefix (bilingual URLs, P1#4),
      // served by the middleware rewrite in src/middleware.ts. Keeping the
      // catch-all would intercept every Arabic URL before the middleware runs.
      // Legacy Shopify `/ar/collections|/ar/products` equity is still recovered
      // above (now to the Arabic /ar/explore). Genuinely-dead legacy /ar paths
      // now correctly 404 instead of 301→/.
    ];
  },
  async rewrites() {
    return [
      // Browser hits /api/* on the same origin as the page. Next.js
      // forwards to the API container server-side, so the eventual
      // Set-Cookie response is recorded against the page origin and
      // SameSite=Strict + HttpOnly cookies are honoured by every
      // browser (incl. WebKit / iOS Safari).
      {
        source: "/api/:path*",
        destination: `${API_PROXY_TARGET}/:path*`,
      },
      // Same trick for uploaded images (and any other static API
      // assets): keep them same-origin so img-src 'self' is enough
      // without whitelisting the API host.
      {
        source: "/uploads/:path*",
        destination: `${UPLOADS_PROXY_TARGET}/uploads/:path*`,
      },
    ];
  },
  images: {
    // Modern formats first — Next.js negotiates based on Accept header
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "jadwal-assets.s3.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "jadwal-assets.s3.me-south-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "cdn.jadwal.qa",
      },
      // CloudFront distribution for uploaded user content. Hostname is
      // injected at build time via NEXT_PUBLIC_CDN_URL so a future swap
      // (e.g. once cdn.jadwal.qa CNAMEs to CloudFront) needs no code edit.
      ...(process.env.NEXT_PUBLIC_CDN_URL
        ? (() => {
            try {
              const u = new URL(process.env.NEXT_PUBLIC_CDN_URL);
              return [{ protocol: u.protocol.replace(":", "") as "https" | "http", hostname: u.hostname }];
            } catch {
              return [];
            }
          })()
        : []),
      // Dev-only: API serves uploads from localhost:4000/uploads/*
      ...(process.env.NODE_ENV === "development"
        ? [
            {
              protocol: "http" as const,
              hostname: "localhost",
              port: "4000",
              pathname: "/uploads/**",
            },
          ]
        : []),
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          // HSTS is gated on ENABLE_HSTS=true so the local prod-build
          // container (still NODE_ENV=production but served over HTTP
          // on localhost) doesn't poison WebKit / iOS Safari into
          // auto-upgrading every localhost request to HTTPS, which
          // breaks all dev/test traffic with SSL connect errors.
          // Real prod deploys set ENABLE_HSTS=true at the edge or in
          // task definition env. CloudFront / ALB also typically add
          // HSTS at the edge regardless.
          ...(process.env.ENABLE_HSTS === "true"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains; preload",
                },
              ]
            : []),
          {
            // Deny powerful browser APIs by default. Geolocation is allowed
            // for same-origin only — the "Near me" / explore features call
            // navigator.geolocation.getCurrentPosition() (apps/web/src/
            // context/geo-context.tsx) and the browser blocks the call
            // entirely if this header omits geolocation=(self). Camera,
            // mic, clipboard etc. remain shut off so a stored-XSS payload
            // can't reach them.
            key: "Permissions-Policy",
            value:
              "geolocation=(self), camera=(), microphone=(), payment=(), " +
              "clipboard-read=(), clipboard-write=(), usb=(), magnetometer=(), " +
              "gyroscope=(), accelerometer=(), ambient-light-sensor=(), " +
              "autoplay=(), encrypted-media=(), fullscreen=(self), " +
              "picture-in-picture=(), display-capture=(), midi=()",
          },
          {
            // Isolates the top-level browsing context so a malicious opener
            // (opened tab, popup, or window.open from an attacker page) can
            // NOT access our window.opener. Pairs with rel="noopener" on
            // target=_blank links as defence in depth.
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            // Prevents other origins from embedding our resources as <img>,
            // <script>, or <link>. Blocks cross-origin data theft if a
            // malicious page tries to load our endpoints as scripts or pixels.
            key: "Cross-Origin-Resource-Policy",
            value: "same-site",
          },
          {
            // Activates cross-origin isolation: the page can only load
            // cross-origin resources that explicitly opt in via a CORP
            // header (or are CORS-fetched). Cross-origin images / scripts
            // without that header are loaded credentialless (no cookies).
            // Pairs with COOP=same-origin above to make the document a
            // protected, isolated browsing context — blocks Spectre-class
            // side-channel reads against our origin.
            //
            // `credentialless` (vs `require-corp`) is chosen because it
            // does NOT block cross-origin assets that lack CORP headers
            // (e.g. third-party images, S3 buckets that don't set CORP);
            // they're just loaded anonymously. Trade-off: a malicious
            // cross-origin script can't read our credentialed responses
            // either way, but `require-corp` is stricter at the cost of
            // breaking image loads we don't control. Revisit when our
            // CDN/S3 is configured to send CORP=cross-origin universally.
            key: "Cross-Origin-Embedder-Policy",
            value: "credentialless",
          },
          // Content-Security-Policy is set per-request in middleware.ts
          // with a cryptographic nonce — see middleware for the full policy.
        ],
      },
      {
        // The kill-switch holding page must never be indexed. The page sets a
        // <meta name="robots"> noindex, but an X-Robots-Tag HTTP header is also
        // honored on non-HTML / error responses and by crawlers that don't
        // parse the body — belt-and-suspenders for /maintenance.
        source: "/maintenance",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
