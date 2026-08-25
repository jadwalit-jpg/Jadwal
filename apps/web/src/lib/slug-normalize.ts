/**
 * Canonical form of an activity slug, used to rescue links to a slug that had
 * stray hyphens.
 *
 * Activity slugs are typed by hand. Until the API validator was tightened it
 * accepted a bare hyphen anywhere, so five activities went live — and into the
 * sitemap — with addresses like:
 *
 *     /activity/catamaran-
 *     /activity/ghatha-resort-
 *     /activity/-desert-camp-full-day-trip-8-hours
 *     /activity/-public-al-safliya-island-water-sports-
 *
 * Cleaning those up in the database would normally break every existing link to
 * them: a bookmark, a WhatsApp share, or Google's current index entry would all
 * land on a not-found page, because nothing records the old address.
 *
 * Rather than a slug-history table and a migration, the activity route falls
 * back to this function when a slug does not resolve: if the normalized form
 * DOES resolve, it issues a permanent redirect to it. That means
 * `/activity/catamaran-` keeps working after `catamaran-` is renamed to
 * `catamaran`, with no stored history and nothing to keep in sync.
 *
 * It is deliberately narrow — it only strips hyphen noise. It will not rescue a
 * genuinely different or misspelt slug, which should still 404.
 */
export function normalizeSlug(slug: string): string {
  return slug
    .replace(/-{2,}/g, '-') // collapse doubled hyphens
    .replace(/^-+/, '') // drop leading hyphens
    .replace(/-+$/, ''); // drop trailing hyphens
}

/**
 * True when `slug` is a hyphen-noise variant of a different, canonical slug —
 * i.e. worth retrying before giving up with a 404.
 *
 * Returns false when normalizing changes nothing (the slug is already clean, so
 * a retry would hit the same miss and could loop) or when normalizing empties
 * it (e.g. "---").
 */
export function hasRedundantHyphens(slug: string): boolean {
  const normalized = normalizeSlug(slug);
  return normalized.length > 0 && normalized !== slug;
}
