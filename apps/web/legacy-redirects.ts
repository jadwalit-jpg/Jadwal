/**
 * Permanent (308) redirects for addresses Google still lists from earlier
 * versions of the site (item 7, Nov 2026 — source: the project doc
 * "jadwal-redirect-map.md", 73 "Not found" URLs from Search Console).
 *
 * Imported by next.config.ts `redirects()`, placed BEFORE the Shopify
 * catch-alls (so /products/versace-yacht wins over /products/*) and before the
 * /ar locale middleware runs (so /ar/... sources match here directly).
 *
 * RULES
 *  - Never redirect to a page that does not exist. Every target below was
 *    checked live when added (activity: GET /api/catalog/activities/<slug> →
 *    200; page: GET <path> → 200). Re-check before editing.
 *  - An old /ar/... address goes to the /ar/ version of its target; the /en/
 *    (or unprefixed) address goes to the English target. Targets here are
 *    written once, in English; the Arabic twin is derived with `ar()`.
 *  - Specific rules first, catch-alls last (Next applies the first match).
 *  - Deliberately NOT redirected (left as 404): encoded share links such as
 *    /97V+xu6mV/ys3zrnwOIHQ==, /cdn-cgi/l/email-protection,
 *    /.well-known/shopify/..., /417.
 *
 * Plain data + small helpers (no app imports) so it is unit-testable.
 */

export interface LegacyRedirect {
  source: string;
  destination: string;
  permanent: true;
}

/**
 * English target → its Arabic twin ('/x' → '/ar/x', '/' → '/ar').
 * Auth pages have no /ar version (the middleware strips /ar off them), so
 * they are returned unchanged to avoid a second hop.
 */
export function ar(path: string): string {
  if (path === '/login' || path.startsWith('/login?')) return path;
  return path === '/' ? '/ar' : `/ar${path}`;
}

/** Renamed activities (current site): old slug → current English path. */
export const ACTIVITY_SLUG_MOVES: Record<string, string> = {
  'al-kadi-resort': '/activity/al-kadi-resort-qatar-private-family-resort',
  'j-rest': '/activity/j-rest-private-chalet-in-qatar',
  // No donut listing exists; do not send to banana boat (owner's decision).
  'donut-ride': '/explore?category=water-activities',
};

/**
 * Previous site's activity ids: /en|ar/activities/<id>[/<any-old-slug>] →
 * current English path. Matched by id, so every old slug spelling works.
 * Ids not listed (e.g. 38 west-coast-explorer, 42/43 test pages) fall to the
 * /explore catch-all below, as the map asks.
 */
export const LEGACY_ACTIVITY_IDS: Record<string, string> = {
  '2': '/activity/overnight-desert-safari-qatar', //       overnight-desert-camp-in-sealine-19-hour-desert-escape (Sealine camp, 2pm→9am = 19h; the "19h" listing no longer exists)
  '3': '/activity/safliyah-water-sports-trip', //          dhow-cruise-water-sports-adventure (listing = 5-hour dhow cruise + jet ski, donut, banana)
  '5': '/activity/private-city-tour', //                   doha-highlights-city-tour-private-guided-tour-in-qatar
  '6': '/activity/traditional-dhow-renting', //            dhow-cruise-bbq[-in-qatar-private-sea-experience-for-groups]
  '7': '/activity/safliyah-water-sports-trip', //          safliyah-water-sports-trip-dhow-cruise-jet-ski-adventure
  '8': '/activity/kayak-ride', //                          kayaking-in-purple-island
  '9': '/desert-safari-qatar', //                          safari-trip (target safari-trip-8h was removed 4 Nov 2026)
  '11': '/activity/overnight-desert-safari-qatar', //      sealine-fireworks-vip-overnight-desert-camp
  '14': '/activity/stone-chalet', //                       hajar-chalet-private-luxury-stay-in-qatar
  '16': '/activity/al-khor-caravan-cabin-1', //            al-khor-overnight-caravan-cabin-stay-private-caravan-staycation-in-qatar-1
  '18': '/activity/royal-home-houseboat', //               royal-houseboat-experience-in-qatar-private-luxury-floating-houseboat
  '20': '/activity/cavilam-resort', //                     cavilam-resort-staycation-in-qatar-private-family-resort
  '21': '/activity/q-houseboat', //                        q-houseboat-experience-in-qatar-private-floating-party-boat
  '22': '/activity/q-luxury-yacht', //                     q-luxury-yacht-qatar-private-yacht-cruise-experience
  '23': '/doha-boat-tour', //                              leisure-cruise-pearl-express-escape
  '24': '/doha-boat-tour', //                              leisure-cruise-west-bay-skyline
  '25': '/doha-boat-tour', //                              leisure-cruise-island-icon-discovery-tour
  '26': '/activity/lusail-apartment', //                   lusail-apartment
  '29': '/activity/north-villa', //                        north-villa
  '30': '/desert-safari-qatar', //                         desert-safari-experiences-half-day-4-hours
  '35': '/activity/speedboat-fishing-trip', //             speedboat-fishing-trip-up-to-6-people
  '44': '/offers', //                                      iftar-meal-donation-campaign-17-qar (campaign ended)
  '53': '/offers', //                                      ramadan-iftar
  '55': '/desert-safari-qatar', //                         desert-camp-overnight-trip-19-hours (target safari-trip-full-day-19h was removed 4 Nov 2026)
};

/** Previous site's category pages: /en|ar/categories/<name> → current English path. */
export const LEGACY_CATEGORIES: Record<string, string> = {
  'resorts-apartments': '/resorts-chalets-qatar',
  'resorts-more': '/resorts-chalets-qatar',
  'water-activities': '/water-activities-qatar',
  'leisure-fun': '/explore?category=leisure-fun',
  'leisure-fun-1': '/explore?category=leisure-fun',
  'ramdan-packages': '/offers',
  'exclusive-packages': '/offers',
  'playgrounds-sports': '/explore',
};

/** Old Shopify product handles: /products/<handle> (and /ar/...) → current English path. */
export const SHOPIFY_PRODUCTS: Record<string, string> = {
  'versace-yacht': '/activity/versace-yacht',
};

/** Previous site's pages: old path WITHOUT the /en|/ar prefix → current English path. */
export const LEGACY_SITE_PAGES: Record<string, string> = {
  '/explore': '/explore', // /en/explore and /en/explore?page=N (query handled in next.config)
  '/terms-and-conditions': '/terms',
  '/contact-us': '/contact',
  '/auth': '/login', //      /en/auth?return=... — query is passed through and ignored by /login
};

/** One-off paths with no language variant. */
const ONE_OFF: LegacyRedirect[] = [
  { source: '/index.html', destination: '/', permanent: true },
];

/** Catch-alls for the old URL patterns — always AFTER every specific rule. */
const CATCH_ALLS: LegacyRedirect[] = [
  { source: '/ar/activities/:path*', destination: '/ar/explore', permanent: true },
  { source: '/en/activities/:path*', destination: '/explore', permanent: true },
  { source: '/ar/categories/:path*', destination: '/ar/explore', permanent: true },
  { source: '/en/categories/:path*', destination: '/explore', permanent: true },
];

const r = (source: string, destination: string): LegacyRedirect => ({ source, destination, permanent: true });

export function legacyRedirects(): LegacyRedirect[] {
  const out: LegacyRedirect[] = [];

  for (const [oldSlug, to] of Object.entries(ACTIVITY_SLUG_MOVES)) {
    out.push(r(`/activity/${oldSlug}`, to), r(`/ar/activity/${oldSlug}`, ar(to)));
  }

  for (const [id, to] of Object.entries(LEGACY_ACTIVITY_IDS)) {
    // `/:rest*` also matches the bare id (/ar/activities/20).
    out.push(r(`/en/activities/${id}/:rest*`, to), r(`/ar/activities/${id}/:rest*`, ar(to)));
  }

  for (const [name, to] of Object.entries(LEGACY_CATEGORIES)) {
    out.push(r(`/en/categories/${name}`, to), r(`/ar/categories/${name}`, ar(to)));
  }

  for (const [handle, to] of Object.entries(SHOPIFY_PRODUCTS)) {
    out.push(r(`/products/${handle}`, to), r(`/ar/products/${handle}`, ar(to)));
  }

  for (const [from, to] of Object.entries(LEGACY_SITE_PAGES)) {
    out.push(r(`/en${from}`, to));
    // /ar/explore is a live page today — never redirect it.
    if (from !== '/explore') out.push(r(`/ar${from}`, ar(to)));
  }

  out.push(...ONE_OFF, ...CATCH_ALLS);
  return out;
}

/** Every English target path, de-duplicated — for live verification before release. */
export function allTargets(): string[] {
  return [
    ...new Set([
      ...Object.values(ACTIVITY_SLUG_MOVES),
      ...Object.values(LEGACY_ACTIVITY_IDS),
      ...Object.values(LEGACY_CATEGORIES),
      ...Object.values(SHOPIFY_PRODUCTS),
      ...Object.values(LEGACY_SITE_PAGES),
    ]),
  ].sort();
}
