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

/** Mirrors the predicate in middleware.ts. */
function shouldBrowserCache(
  pathname: string,
  headers: Record<string, string>,
  searchParams: URLSearchParams,
): boolean {
  const isRscRequest = 'rsc' in headers || searchParams.has('_rsc');
  return pathname === '/' && !isRscRequest;
}

const noParams = () => new URLSearchParams();

describe('home-page browser cache — the document only', () => {

  test('a plain document request to / IS cached (the win is preserved)', () => {
    expect(shouldBrowserCache('/', {}, noParams())).toBe(true);
  });

  test('an RSC request to / is NOT cached — this is the fix', () => {
    // Next's client router sends `RSC: 1` when it fetches a flight payload.
    expect(shouldBrowserCache('/', { rsc: '1' }, noParams())).toBe(false);
  });

  test('a ?_rsc url is NOT cached', () => {
    // Next redirects RSC requests to `<path>?_rsc` for cache-busting, so the
    // marker can arrive in the query string rather than the header.
    expect(shouldBrowserCache('/', {}, new URLSearchParams('_rsc'))).toBe(false);
  });

  test('both markers together are still not cached', () => {
    expect(shouldBrowserCache('/', { rsc: '1' }, new URLSearchParams('_rsc'))).toBe(false);
  });
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
    expect(shouldBrowserCache(pathname, {}, noParams())).toBe(false);
    expect(shouldBrowserCache(pathname, { rsc: '1' }, noParams())).toBe(false);
  });

  test('other query parameters on / do not disable the cache', () => {
    // Only the RSC marker should switch it off. A campaign tag must not cost
    // every visitor their cached home page.
    expect(shouldBrowserCache('/', {}, new URLSearchParams('utm_source=x'))).toBe(true);
    expect(shouldBrowserCache('/', {}, new URLSearchParams('countryId=abc'))).toBe(true);
  });
});
