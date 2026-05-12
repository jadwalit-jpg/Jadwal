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
 * `'strict-dynamic'` note: only the inline `<script>` tags in the HTML need the
 * nonce — the chunks they pull in (`/_next/static/...`) are trusted via
 * `'strict-dynamic'`, so we don't need to chase those.
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

    // Stream-rewrite the <script nonce="…"> attributes to the new nonce.
    const rewriter = new HTMLRewriter().on('script[nonce]', {
      element(el) {
        el.setAttribute('nonce', newNonce);
      },
    });

    return rewriter.transform(
      new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      }),
    );
  },
};
