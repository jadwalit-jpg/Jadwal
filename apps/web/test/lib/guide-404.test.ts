/**
 * Unknown guide slugs must return a real 404 status, not a soft 404.
 *
 * WHY THIS IS DECIDED IN MIDDLEWARE. `notFound()` inside app/blog/[slug]
 * cannot set the status: the route streams (the response carries
 * `Transfer-Encoding: chunked`), so by the time the unknown slug is discovered
 * the 200 status line has already been written. Next can swap in the not-found
 * UI but not the status. Measured before the fix: /blog/anything returned 200.
 *
 * The danger of the fix is the opposite failure — 404ing a page that DOES
 * exist, which would delist real content. So the tests below spend most of
 * their effort on what must still resolve, not on what must 404.
 */
// `middleware.ts` imports `next/server`, which subclasses Edge-runtime globals
// at import time; jsdom does not define them. Same stub approach as csp.test.ts.
for (const name of ['Request', 'Response', 'Headers'] as const) {
  const g = globalThis as unknown as Record<string, unknown>;
  if (typeof g[name] === 'undefined') g[name] = class {};
}

// Required, not imported: the stubs must exist BEFORE `next/server` evaluates.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isUnknownGuidePath } = require('@/middleware') as typeof import('@/middleware');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SEO_GUIDES } = require('@/lib/seo-guides') as typeof import('@/lib/seo-guides');

describe('real guides must NEVER 404', () => {
  // Derived from the registry rather than hardcoded, so adding a guide can
  // never silently fall outside this guard.
  it.each(SEO_GUIDES.map((g) => [g.slug, g.published] as const))(
    '/blog/%s resolves (published=%s)',
    (slug) => {
      expect(isUnknownGuidePath(`/blog/${slug}`)).toBe(false);
    },
  );

  it('includes UNPUBLISHED guides too — dormant is not missing', () => {
    // A draft guide renders (noindex) so its URL can be previewed and approved.
    // 404ing it would break that review step entirely.
    const drafts = SEO_GUIDES.filter((g) => !g.published);
    for (const g of drafts) {
      expect(isUnknownGuidePath(`/blog/${g.slug}`)).toBe(false);
    }
  });

  it('leaves the blog index alone', () => {
    expect(isUnknownGuidePath('/blog')).toBe(false);
  });

  it.each([
    '/',
    '/explore',
    '/about',
    '/login',
    '/desert-safari-qatar',
    '/activity/some-activity',
    '/account/bookings',
    '/admin/dashboard',
    '/vendor/activities',
    '/api/catalog/activities',
  ])('never claims %s is a missing guide', (path) => {
    // The check must be inert everywhere outside /blog/. A false positive here
    // would take down a real route.
    expect(isUnknownGuidePath(path)).toBe(false);
  });
});

describe('unknown guide slugs are reported missing', () => {
  it.each([
    '/blog/definitely-not-a-guide',
    '/blog/things-to-do-in-qatar-typo',
    '/blog/2024-old-renamed-slug',
  ])('%s is unknown', (path) => {
    expect(isUnknownGuidePath(path)).toBe(true);
  });

  it('treats deeper paths under /blog as unknown', () => {
    // /blog/a/b matches no route; without this it would fall through to a soft
    // 404 like everything else.
    expect(isUnknownGuidePath('/blog/a/b')).toBe(true);
    expect(isUnknownGuidePath('/blog/things-to-do-in-qatar/extra')).toBe(true);
  });

  it('is case-sensitive, matching how the slugs are actually routed', () => {
    // Slugs are lowercase; an uppercase variant is a different URL and does not
    // resolve, so reporting it missing is correct rather than pedantic.
    expect(isUnknownGuidePath('/blog/Things-To-Do-In-Qatar')).toBe(true);
  });
});
