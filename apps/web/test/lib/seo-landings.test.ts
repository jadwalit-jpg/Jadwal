import {
  SEO_LANDINGS,
  getLanding,
  allLandingSlugs,
  launchedLandings,
  landingCopy,
} from '@/lib/seo-landings';

// Single-segment top-level routes that already exist under app/. The root
// [landingSlug] catch-all must NEVER define one of these slugs — static routes
// win, but a clash would mean a dead/duplicate config entry. (Includes `blog`,
// reserved for Phase B.)
const RESERVED_ROUTES = new Set([
  'about', 'account', 'activity', 'admin', 'api', 'blog', 'bookings', 'contact',
  'explore', 'forgot-password', 'health', 'likes', 'login', 'maintenance',
  'notifications', 'offers', 'payment', 'privacy', 'profile', 'register',
  'reset-password', 'terms', 'vendor', 'verify-email',
]);

describe('seo-landings config integrity', () => {
  test('every slug is unique', () => {
    const slugs = allLandingSlugs();
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test('every slug is a valid lowercase-hyphen URL segment', () => {
    for (const s of allLandingSlugs()) {
      expect(s).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  test('no slug collides with an existing top-level route', () => {
    for (const s of allLandingSlugs()) {
      expect(RESERVED_ROUTES.has(s)).toBe(false);
    }
  });

  test('every related slug resolves to a real, launched landing', () => {
    for (const l of SEO_LANDINGS) {
      for (const r of l.related) {
        const target = getLanding(r);
        expect(target).toBeDefined();
        // internal links should point only at launched (indexable) pages
        expect(target!.launched).toBe(true);
      }
    }
  });

  test('launched pages have full EN + AR override copy (not templated)', () => {
    for (const l of launchedLandings()) {
      expect(l.copy?.en?.h1).toBeTruthy();
      expect(l.copy?.en?.metaTitle).toBeTruthy();
      expect(l.copy?.en?.metaDescription).toBeTruthy();
      expect(l.copy?.ar?.h1).toBeTruthy();
      expect(l.copy?.ar?.metaTitle).toBeTruthy();
      expect(l.copy?.ar?.metaDescription).toBeTruthy();
    }
  });

  test('every landing has a usable filter (category OR search)', () => {
    for (const l of SEO_LANDINGS) {
      expect(Boolean(l.filter.category) || Boolean(l.filter.search)).toBe(true);
    }
  });

  test('landingCopy always returns non-empty strings (override or templated)', () => {
    for (const l of SEO_LANDINGS) {
      for (const lang of ['en', 'ar'] as const) {
        const c = landingCopy(l, lang);
        expect(c.h1).toBeTruthy();
        expect(c.intro).toBeTruthy();
        expect(c.metaTitle).toBeTruthy();
        expect(c.metaDescription).toBeTruthy();
      }
    }
  });

  test('there is at least one launched page and meta descriptions are SEO-length', () => {
    const launched = launchedLandings();
    expect(launched.length).toBeGreaterThanOrEqual(1);
    for (const l of launched) {
      const desc = l.copy!.en!.metaDescription;
      expect(desc.length).toBeGreaterThanOrEqual(80);
      expect(desc.length).toBeLessThanOrEqual(170);
    }
  });
});
