/**
 * Legacy 308s (item 7). A wrong redirect is silent and expensive: it throws
 * away the ranking the old URL earned, or sends Google to a dead page. These
 * pin the rules; the live existence of every target (allTargets()) is checked
 * against the site before release.
 */
import { legacyRedirects, allTargets, ar } from '../legacy-redirects';

/** Minimal path-to-regexp subset used by these rules: literal segments, `:name`, `:name*`. */
function matches(source: string, path: string): boolean {
  const re = '^' + source
    .replace(/[\\.]/g, '\\$&')
    .replace(/\/:(\w+)\*/g, '(?:/.*)?')
    .replace(/:(\w+)/g, '[^/]+') + '$';
  return new RegExp(re).test(path);
}

function resolve(path: string): string | null {
  const hit = legacyRedirects().find((r) => matches(r.source, path));
  return hit ? hit.destination : null;
}

/** Assert an old address in BOTH languages: /en|ar<old> → <target> | /ar<target>. */
function both(oldNoPrefix: string, target: string) {
  expect(resolve(`/en${oldNoPrefix}`)).toBe(target);
  expect(resolve(`/ar${oldNoPrefix}`)).toBe(ar(target));
}

describe('legacy redirects — the owner\'s map (jadwal-redirect-map.md)', () => {
  it('old activity pages → current listings, both languages', () => {
    both('/activities/6/dhow-cruise-bbq', '/activity/traditional-dhow-renting');
    both('/activities/6/dhow-cruise-bbq-in-qatar-private-sea-experience-for-groups', '/activity/traditional-dhow-renting');
    both('/activities/5/doha-highlights-city-tour-private-guided-tour-in-qatar', '/activity/private-city-tour');
    both('/activities/29/north-villa', '/activity/north-villa');
    both('/activities/26/lusail-apartment', '/activity/lusail-apartment');
    both('/activities/22/q-luxury-yacht-qatar-private-yacht-cruise-experience', '/activity/q-luxury-yacht');
    both('/activities/21/q-houseboat-experience-in-qatar-private-floating-party-boat', '/activity/q-houseboat');
    both('/activities/18/royal-houseboat-experience-in-qatar-private-luxury-floating-houseboat', '/activity/royal-home-houseboat');
    both('/activities/7/safliyah-water-sports-trip-dhow-cruise-jet-ski-adventure', '/activity/safliyah-water-sports-trip');
    both('/activities/3/dhow-cruise-water-sports-adventure', '/activity/safliyah-water-sports-trip');
    both('/activities/16/al-khor-overnight-caravan-cabin-stay-private-caravan-staycation-in-qatar-1', '/activity/al-khor-caravan-cabin-1');
    both('/activities/30/desert-safari-experiences-half-day-4-hours', '/desert-safari-qatar');
    both('/activities/2/overnight-desert-camp-in-sealine-19-hour-desert-escape', '/activity/overnight-desert-safari-qatar');
    both('/activities/11/sealine-fireworks-vip-overnight-desert-camp', '/activity/overnight-desert-safari-qatar');
    both('/activities/8/kayaking-in-purple-island', '/activity/kayak-ride');
    for (const id of ['23', '24', '25']) both(`/activities/${id}/leisure-cruise`, '/doha-boat-tour');
    both('/activities/44/iftar-meal-donation-campaign-17-qar', '/offers');
    both('/activities/53/ramadan-iftar', '/offers');
    both('/activities/20/cavilam-resort-staycation-in-qatar-private-family-resort', '/activity/cavilam-resort');
    both('/activities/14/hajar-chalet-private-luxury-stay-in-qatar', '/activity/stone-chalet');
    both('/activities/35/speedboat-fishing-trip-up-to-6-people', '/activity/speedboat-fishing-trip');
  });

  it('ids whose listing was removed go to the desert safari page', () => {
    both('/activities/9/safari-trip', '/desert-safari-qatar');
    both('/activities/55/desert-camp-overnight-trip-19-hours', '/desert-safari-qatar');
  });

  it('unlisted old ids (38, 42, 43, anything else) fall to /explore', () => {
    both('/activities/38/west-coast-explorer', '/explore');
    both('/activities/43/test', '/explore');
    both('/activities/999', '/explore');
  });

  it('matches an id with or without a slug (and a longer id is not confused with a shorter one)', () => {
    expect(resolve('/ar/activities/20')).toBe('/ar/activity/cavilam-resort');
    expect(resolve('/en/activities/2')).toBe('/activity/overnight-desert-safari-qatar');
    expect(resolve('/en/activities/22/x')).toBe('/activity/q-luxury-yacht'); // not id 2
    expect(resolve('/en/activities/25/x')).toBe('/doha-boat-tour'); // not id 2
  });

  it('old category pages → guide pages, offers or a filtered /explore', () => {
    both('/categories/resorts-apartments', '/resorts-chalets-qatar');
    both('/categories/resorts-more', '/resorts-chalets-qatar');
    expect(resolve('/ar/categories/water-activities')).toBe('/ar/water-activities-qatar');
    both('/categories/leisure-fun', '/explore?category=leisure-fun');
    both('/categories/leisure-fun-1', '/explore?category=leisure-fun');
    both('/categories/ramdan-packages', '/offers');
    both('/categories/exclusive-packages', '/offers');
    both('/categories/playgrounds-sports', '/explore');
    both('/categories/unknown-old-category', '/explore');
  });

  it('old site pages and products', () => {
    expect(resolve('/en/explore')).toBe('/explore');
    expect(resolve('/en/terms-and-conditions')).toBe('/terms');
    expect(resolve('/ar/terms-and-conditions')).toBe('/ar/terms');
    expect(resolve('/en/contact-us')).toBe('/contact');
    expect(resolve('/ar/contact-us')).toBe('/ar/contact');
    expect(resolve('/en/auth')).toBe('/login');
    expect(resolve('/ar/auth')).toBe('/login'); // /login has no /ar twin — one hop, not two
    expect(resolve('/index.html')).toBe('/');
    expect(resolve('/products/versace-yacht')).toBe('/activity/versace-yacht');
    expect(resolve('/ar/products/versace-yacht')).toBe('/ar/activity/versace-yacht');
  });

  it('current-site renames', () => {
    expect(resolve('/activity/al-kadi-resort')).toBe('/activity/al-kadi-resort-qatar-private-family-resort');
    expect(resolve('/activity/j-rest')).toBe('/activity/j-rest-private-chalet-in-qatar');
    expect(resolve('/ar/activity/j-rest')).toBe('/ar/activity/j-rest-private-chalet-in-qatar');
    expect(resolve('/activity/donut-ride')).toBe('/explore?category=water-activities');
  });
});

describe('legacy redirects — safety', () => {
  it('leaves the owner\'s "keep as 404" list alone', () => {
    for (const p of ['/97V+xu6mV/ys3zrnwOIHQ==', '/cdn-cgi/l/email-protection', '/.well-known/shopify/monorail/unstable/produce_batch', '/417']) {
      expect(resolve(p)).toBeNull();
    }
  });

  it('never shadows a live route', () => {
    for (const live of ['/activity/cavilam-resort', '/ar/activity/stone-chalet', '/explore', '/ar/explore', '/login', '/', '/ar', '/offers', '/desert-safari-qatar', '/terms', '/contact']) {
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
    const shape = /^\/(ar(\/|$))?(activity\/[a-z0-9-]+|explore(\?category=[a-z0-9-]+)?|login|offers|terms|contact|desert-safari-qatar|doha-boat-tour|resorts-chalets-qatar|water-activities-qatar)?$/;
    for (const { destination } of legacyRedirects()) expect(destination).toMatch(shape);
  });

  it('allTargets() covers every destination for live verification', () => {
    const targets = new Set(allTargets());
    for (const { destination } of legacyRedirects()) {
      const en = destination.replace(/^\/ar(?=\/|$)/, '') || '/';
      if (['/', '/explore'].includes(en)) continue; // catch-all / one-off targets, always live
      expect(targets.has(en)).toBe(true);
    }
  });
});
