/**
 * Unit — the home page's browser cache must never hold an RSC payload.
 *
 * REPORTED 2026-09-12
 * -------------------
 * A tester on an iPhone, mid login/logout cycle, landed on a blank page showing
 * raw React flight data as text:
 *
 *     0:{"f":[[["",{"children":["__PAGE__",{},"$undefined","$undefined",4096]}…
 *
 * The address bar read `jadwal.qa` — no `?_rsc`. That detail is the diagnosis:
 * the browser was not NAVIGATING to an RSC url, it replayed a CACHED RSC body
 * for a plain request to `/`.
 *
 * Middleware sets `private, max-age=300, must-revalidate` on `/` so each
 * visitor's repeat views are instant. That header was applied to every response
 * for that pathname — including the flight stream Next serves as
 * `text/x-component` for the same url. `Vary: rsc` is meant to keep the two
 * apart in the cache, and iOS Safari does not honour Vary reliably on
 * back/restore. Prefetches populate that entry constantly, and logging out
 * redirects straight to `/`, so the two lined up.
 *
 * These tests pin the rule that prevents it: cache the DOCUMENT, never the
 * flight payload — while keeping the performance win the header exists for.
 */

/**
 * Mirrors the predicate in middleware.ts.
 *
 * The FIRST attempt tried to detect an RSC request — `headers.has('rsc')` or
 * `searchParams.has('_rsc')`. Verified against production: neither fires. Next
 * strips its internal `_rsc` param from `nextUrl` before middleware runs, and
 * the RSC header does not match there either, so the flight payload still came
 * back with a five-minute private cache.
 *
 * Gating POSITIVELY on a document navigation avoids guessing at Next
 * internals: browsers send `Sec-Fetch-Dest: document` for a real navigation
 * and `empty` for the router's fetches. Anything unidentified is simply not
 * cached — one uncached page load, rather than a visitor staring at raw
 * payload text.
 */
function shouldBrowserCache(pathname: string, secFetchDest?: string): boolean {
  return pathname === '/' && secFetchDest === 'document';
}

describe('home-page browser cache — document navigations only', () => {

  test('a real navigation to / IS cached (the win is preserved)', () => {
    expect(shouldBrowserCache('/', 'document')).toBe(true);
  });

  test("the router's RSC fetch is NOT cached — this is the fix", () => {
    // Next's client router fetches the flight payload with fetch(), which the
    // browser labels `empty`. That response is what appeared as raw text.
    expect(shouldBrowserCache('/', 'empty')).toBe(false);
  });

  test('a request with NO Sec-Fetch-Dest is not cached', () => {
    // curl, bots, and anything we cannot positively identify. Erring toward
    // "do not cache" costs one page load; erring the other way is the bug.
    expect(shouldBrowserCache('/', undefined)).toBe(false);
  });

  test.each([['iframe'], ['script'], ['image'], ['object']])(
    'a %s subresource request is not cached', (dest) => {
      expect(shouldBrowserCache('/', dest)).toBe(false);
    },
  );
});

describe('home-page browser cache — scope is unchanged', () => {

  test.each([
    ['/explore'],
    ['/ar'],
    ['/login'],
    ['/activity/some-slug'],
    ['/bookings/123'],
  ])('%s was never browser-cached and still is not', (pathname) => {
    // The header was always scoped to `/` alone — per-user and per-country
    // content elsewhere must keep hitting the origin. Pinned so a future edit
    // cannot widen it by accident.
    expect(shouldBrowserCache(pathname, 'document')).toBe(false);
    expect(shouldBrowserCache(pathname, 'empty')).toBe(false);
  });
});
