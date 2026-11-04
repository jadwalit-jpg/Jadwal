/**
 * Legacy 301s (item 7). A wrong redirect is silent and expensive: it throws
 * away the ranking the old URL earned, or sends Google to a dead page. These
 * pin the rules; the live existence of each destination slug is verified
 * against the catalog before release (see destinationActivitySlugs()).
 */
import {
  legacyRedirects,
  destinationActivitySlugs,
  ACTIVITY_SLUG_MOVES,
  LEGACY_ACTIVITY_IDS,
} from '../legacy-redirects';

/** Minimal path-to-regexp subset used by these rules: literal segments, `:name`, `:name*`. */
function matches(source: string, path: string): boolean {
  const re = '^' + source
    .replace(/[.]/g, '\\.')
    .replace(/\/:(\w+)\*/g, '(?:/.*)?')
    .replace(/:(\w+)/g, '[^/]+') + '$';
  return new RegExp(re).test(path);
}

function resolve(path: string): string | null {
  const hit = legacyRedirects().find((r) => matches(r.source, path));
  return hit ? hit.destination : null;
}

describe('legacy redirects', () => {
  it('maps the confirmed addresses from Search Console', () => {
    expect(resolve('/activity/al-kadi-resort')).toBe('/activity/al-kadi-resort-qatar-private-family-resort');
    expect(resolve('/activity/j-rest')).toBe('/activity/j-rest-private-chalet-in-qatar');
    expect(resolve('/ar/activity/j-rest')).toBe('/ar/activity/j-rest-private-chalet-in-qatar');
    expect(resolve('/activity/donut-ride')).toBe('/explore?category=water-activities');
    expect(resolve('/ar/activities/20/cavilam-resort-staycation-in-qatar-private-family-resort')).toBe('/ar/activity/cavilam-resort');
    expect(resolve('/ar/activities/6/dhow-cruise-bbq')).toBe('/ar/activity/traditional-dhow-renting');
    expect(resolve('/ar/activities/14/hajar-chalet-private-luxury-stay-in-qatar')).toBe('/ar/activity/stone-chalet');
    expect(resolve('/ar/activities/35/speedboat-fishing-trip-up-to-6-people')).toBe('/ar/activity/speedboat-fishing-trip');
    expect(resolve('/en/auth')).toBe('/login');
    expect(resolve('/index.html')).toBe('/');
  });

  it('matches an old id with or without a slug, in both languages', () => {
    expect(resolve('/ar/activities/20')).toBe('/ar/activity/cavilam-resort');
    expect(resolve('/en/activities/20')).toBe('/activity/cavilam-resort');
    expect(resolve('/en/activities/6/anything-else')).toBe('/activity/traditional-dhow-renting');
  });

  it('sends unknown old ids and categories to /explore in the right language', () => {
    expect(resolve('/ar/activities/999/some-old-thing')).toBe('/ar/explore');
    expect(resolve('/en/activities/999')).toBe('/explore');
    expect(resolve('/ar/categories/unknown')).toBe('/ar/explore');
  });

  it('never shadows a live route', () => {
    for (const live of ['/activity/cavilam-resort', '/ar/activity/stone-chalet', '/explore', '/ar/explore', '/login', '/', '/ar']) {
      expect(resolve(live)).toBeNull();
    }
  });

  it('puts every catch-all after all specific rules, with no duplicate sources', () => {
    const rules = legacyRedirects();
    const firstCatchAll = rules.findIndex((r) => r.source.endsWith('/:path*'));
    expect(firstCatchAll).toBeGreaterThan(0);
    expect(rules.slice(firstCatchAll).every((r) => r.source.endsWith('/:path*'))).toBe(true);
    const sources = rules.map((r) => r.source);
    expect(new Set(sources).size).toBe(sources.length);
    expect(rules.every((r) => r.permanent === true)).toBe(true);
  });

  it('only targets real route shapes', () => {
    for (const { destination } of legacyRedirects()) {
      expect(destination).toMatch(/^\/(ar(\/|$))?(activity\/[a-z0-9-]+|explore(\?category=[a-z0-9-]+)?|login)?$/);
    }
  });

  it('lists every destination slug for live verification', () => {
    const slugs = destinationActivitySlugs();
    for (const s of [...Object.values(ACTIVITY_SLUG_MOVES), ...Object.values(LEGACY_ACTIVITY_IDS)]) {
      expect(slugs).toContain(s);
    }
  });
});
