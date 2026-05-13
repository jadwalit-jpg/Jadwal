/**
 * Cloudflare Worker — per-request CSP-nonce re-injector for `/home`.
 *
 * WHY: `/home`'s HTML is identical for every same-language visitor (the hero
 * is static markup; the below-fold data is fetched client-side), so it's a
 * great edge-cache candidate — EXCEPT that Next.js bakes a one-time-per-render
 * CSP nonce into the HTML (`<script nonce="…">` + the `Content-Security-Policy`
 * header), and caching freezes that nonce → it becomes predictable → the strict
 * `script-src 'self' 'nonce-…' 'strict-dynamic'` policy loses its teeth.
 *
 * This Worker lets us have both: the SSR'd HTML body is edge-cached (via a
 * Cloudflare Cache Rule on `/home`), and on EVERY request the Worker swaps the
 * cached copy's nonce for a fresh random one — in the response header AND on
 * every `<script>` tag — before handing it to the browser. The Worker's output
 * is never re-cached (only the `fetch()` to origin is), so the cached body is
 * reused but re-stamped each time.
 *
 * Safe whether or not `/home` is actually cached:
 *   - cache OFF → `fetch()` hits the origin, which already emitted a fresh
 *     nonce; the Worker re-stamps to another fresh one. Harmless / a no-op.
 *   - cache ON  → `fetch()` returns the cached HTML (with whatever nonce filled
 *     the cache); the Worker re-stamps it fresh per request.
 *
 * SCOPE: attach this ONLY to the `/home` route (see wrangler.toml). It must not
 * touch any other path. It only rewrites responses that are 2xx + `text/html`
 * + carry a `Content-Security-Policy` header with a `'nonce-…'` token; anything
 * else passes through untouched.
 *
 * Next stamps the nonce on `<script>` tags AND on a few `<link>` tags
 * (`rel=stylesheet`, `rel=preload as=script`); we rewrite both. The `<link
 * rel=preload as=script nonce>` in particular: under `script-src … 'nonce-X'
 * 'strict-dynamic'` a preload whose nonce ≠ X is *blocked* (console CSP error
 * + the preload is wasted, though the page still works via the real
 * `<script nonce=X>` + `strict-dynamic`), so it must match too.
 *
 * What we DON'T touch: the nonce values serialized inside the `self.__next_f`
 * flight-data scripts (React's preload hints + the next-themes `nonce` prop) —
 * those are string contents, not real elements; they don't gate script
 * execution and don't break hydration (React tolerates `nonce` attr diffs).
 *
 * `'strict-dynamic'`: once a nonce-trusted `<script>` runs, the chunks it loads
 * (`/_next/static/...`) are trusted automatically — no need to chase those.
 */

const NONCE_BYTES = 16;

/** 16 random bytes → base64 (mirrors apps/web/src/middleware.ts). */
function freshNonce() {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Per-country eyebrow rewrite — same pattern as the nonce restamp, but for
 * the hero's country line. We only need this because Cloudflare's free plan
 * Cache Rules cannot include a header in the cache key — so cached HTML
 * would otherwise carry whichever country the cache-populator was in (e.g.
 * frozen to "Qatar" forever once a QA visitor warmed the cache). On every
 * request the Worker reads `CF-IPCountry` + the `jadwal_lang` cookie and
 * rewrites the eyebrow `<p data-eyebrow="country">…</p>`. Mirrors the
 * server-side map in `apps/web/src/app/_home-islands/hero-eyebrow.tsx`;
 * keep the two in sync.
 */
const COUNTRY_NAMES = {
  QA: { en: 'Qatar', ar: 'قطر' },
  SA: { en: 'Saudi Arabia', ar: 'السعودية' },
  AE: { en: 'United Arab Emirates', ar: 'الإمارات' },
  KW: { en: 'Kuwait', ar: 'الكويت' },
  BH: { en: 'Bahrain', ar: 'البحرين' },
  OM: { en: 'Oman', ar: 'عُمان' },
};

function eyebrowText(countryCode, isAr) {
  const name = COUNTRY_NAMES[countryCode]?.[isAr ? 'ar' : 'en'];
  if (isAr) return name ? `${name} · تجارب محلية` : 'تجارب محلية في الخليج';
  return name ? `${name} · Local experiences` : 'Local experiences in the Gulf';
}

/** Tiny cookie reader — pulls `jadwal_lang` out of a `Cookie:` header value. */
function readLangCookie(cookieHeader) {
  if (!cookieHeader) return 'en';
  const m = cookieHeader.match(/(?:^|;\s*)jadwal_lang=([^;]+)/);
  return m && m[1] === 'ar' ? 'ar' : 'en';
}

export default {
  /**
   * @param {Request} request
   */
  async fetch(request) {
    // Pass through anything that isn't a normal GET — POST/HEAD/etc. on /home
    // shouldn't happen, but don't risk buffering them.
    if (request.method !== 'GET') return fetch(request);

    // `fetch(request)` honors Cloudflare's edge cache (and the /home Cache
    // Rule) — HIT returns the cached HTML, BYPASS/MISS goes to origin.
    const response = await fetch(request);

    // Only rewrite real HTML pages we can safely buffer + transform.
    if (!response.ok) return response; // 3xx redirects, 304, 4xx/5xx — leave alone
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return response;

    const csp = response.headers.get('content-security-policy');
    if (!csp) return response;
    const match = csp.match(/'nonce-([^']+)'/);
    if (!match) return response; // no nonce in this policy → nothing to do
    const oldNonce = match[1];
    const newNonce = freshNonce();

    // Swap the nonce token in the CSP response header (all occurrences).
    const newHeaders = new Headers(response.headers);
    newHeaders.set(
      'content-security-policy',
      csp.split(`'nonce-${oldNonce}'`).join(`'nonce-${newNonce}'`),
    );
    // Belt-and-braces: this body carries a per-request nonce now, so don't let
    // any downstream cache (including the browser) hold onto it. The /home
    // Cache Rule should already set browser_ttl=respect_origin (origin =
    // no-store), but be explicit in case the rule changes.
    newHeaders.set('cache-control', 'private, no-store, max-age=0, must-revalidate');

    // Stream-rewrite the nonce attribute on every <script> and <link> that
    // carries one, to the fresh nonce.
    const restamp = {
      element(el) {
        el.setAttribute('nonce', newNonce);
      },
    };

    // Per-visitor eyebrow text — see `eyebrowText` above for the rationale.
    // We always rewrite (not only on cache HIT) because the lang-cookie
    // bypass means EN-cookie / AR-cookie traffic doesn't hit the cache, but
    // the Worker still runs on those requests; rewriting in those cases is a
    // safe no-op that overwrites the correct text with the same correct text.
    const countryCode = (request.headers.get('CF-IPCountry') || '').toUpperCase();
    const isAr = readLangCookie(request.headers.get('Cookie')) === 'ar';
    const newEyebrow = eyebrowText(countryCode, isAr);
    const eyebrowRewriter = {
      element(el) {
        // `setInnerContent(text)` HTML-escapes by default — fine since the
        // map values are plain strings (Arabic / Latin letters + `·` and
        // spaces). The eyebrow `<p>` has only the text node we render in
        // hero-eyebrow.tsx; no child elements to preserve.
        el.setInnerContent(newEyebrow);
      },
    };

    const rewriter = new HTMLRewriter()
      .on('script[nonce]', restamp)
      .on('link[nonce]', restamp)
      .on('p[data-eyebrow="country"]', eyebrowRewriter);

    return rewriter.transform(
      new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      }),
    );
  },
};
