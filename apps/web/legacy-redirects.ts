/**
 * Permanent (301/308) redirects for addresses Google still lists from earlier
 * versions of the site (item 7, Nov 2026). Imported by next.config.ts
 * `redirects()`, which runs BEFORE the /ar locale middleware, so `/ar/...`
 * sources match here directly.
 *
 * RULE: never redirect to a page that does not exist. Every activity slug used
 * as a destination below was checked against the live catalog
 * (GET /api/catalog/activities/<slug> → 200) when it was added; re-check with
 * the verification step in the PR notes when editing.
 *
 * Kept as plain data (no app imports) so it can be unit-tested and so the
 * remaining entries from the redirect map can be added without touching logic.
 */

export interface LegacyRedirect {
  source: string;
  destination: string;
  permanent: true;
}

/** Renamed activities: old slug → current slug (both languages are generated). */
export const ACTIVITY_SLUG_MOVES: Record<string, string> = {
  'al-kadi-resort': 'al-kadi-resort-qatar-private-family-resort',
  'j-rest': 'j-rest-private-chalet-in-qatar',
};

/**
 * Removed activities with no single equivalent: old slug → an /explore filter
 * (query string, no leading "?"). Both languages are generated.
 */
export const ACTIVITY_TO_EXPLORE: Record<string, string> = {
  'donut-ride': 'category=water-activities',
};

/**
 * Previous site's numeric activity ids (/ar|en/activities/<id>[/<old-slug>])
 * → current slug. Matched by id, so any old slug spelling after the id works.
 */
export const LEGACY_ACTIVITY_IDS: Record<string, string> = {
  '6': 'traditional-dhow-renting', //   dhow-cruise-bbq
  '14': 'stone-chalet', //              hajar-chalet-private-luxury-stay-in-qatar
  '20': 'cavilam-resort', //            cavilam-resort-staycation-in-qatar-private-family-resort
  '35': 'speedboat-fishing-trip', //    speedboat-fishing-trip-up-to-6-people
};

/**
 * Previous site's category pages (/ar|en/categories/<name>) → current category
 * slug for /explore?category=<slug>. Anything not listed falls back to /explore.
 */
export const LEGACY_CATEGORIES: Record<string, string> = {};

/** One-off paths. */
const ONE_OFF: LegacyRedirect[] = [
  { source: '/en/auth', destination: '/login', permanent: true },
  { source: '/index.html', destination: '/', permanent: true },
];

/**
 * Catch-alls for the old URL patterns, AFTER every specific rule (Next.js
 * applies the first matching redirect).
 */
const CATCH_ALLS: LegacyRedirect[] = [
  { source: '/ar/activities/:path*', destination: '/ar/explore', permanent: true },
  { source: '/en/activities/:path*', destination: '/explore', permanent: true },
  { source: '/ar/categories/:path*', destination: '/ar/explore', permanent: true },
  { source: '/en/categories/:path*', destination: '/explore', permanent: true },
];

export function legacyRedirects(): LegacyRedirect[] {
  const out: LegacyRedirect[] = [];

  for (const [oldSlug, slug] of Object.entries(ACTIVITY_SLUG_MOVES)) {
    out.push({ source: `/activity/${oldSlug}`, destination: `/activity/${slug}`, permanent: true });
    out.push({ source: `/ar/activity/${oldSlug}`, destination: `/ar/activity/${slug}`, permanent: true });
  }

  for (const [oldSlug, query] of Object.entries(ACTIVITY_TO_EXPLORE)) {
    out.push({ source: `/activity/${oldSlug}`, destination: `/explore?${query}`, permanent: true });
    out.push({ source: `/ar/activity/${oldSlug}`, destination: `/ar/explore?${query}`, permanent: true });
  }

  for (const [id, slug] of Object.entries(LEGACY_ACTIVITY_IDS)) {
    // `/:rest*` also matches the bare id (/ar/activities/20).
    out.push({ source: `/ar/activities/${id}/:rest*`, destination: `/ar/activity/${slug}`, permanent: true });
    out.push({ source: `/en/activities/${id}/:rest*`, destination: `/activity/${slug}`, permanent: true });
  }

  for (const [name, slug] of Object.entries(LEGACY_CATEGORIES)) {
    out.push({ source: `/ar/categories/${name}`, destination: `/ar/explore?category=${slug}`, permanent: true });
    out.push({ source: `/en/categories/${name}`, destination: `/explore?category=${slug}`, permanent: true });
  }

  out.push(...ONE_OFF, ...CATCH_ALLS);
  return out;
}

/** Every current activity slug used as a destination — for live verification. */
export function destinationActivitySlugs(): string[] {
  return [...new Set([...Object.values(ACTIVITY_SLUG_MOVES), ...Object.values(LEGACY_ACTIVITY_IDS)])].sort();
}
