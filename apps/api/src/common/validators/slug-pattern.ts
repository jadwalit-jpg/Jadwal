/**
 * The one definition of a valid URL slug.
 *
 * Slugs are typed by hand by vendors and admins (they are not generated from
 * the title), so the validator is the only thing standing between a typo and a
 * permanent public URL.
 *
 * The previous pattern was `/^[a-z0-9-]+$/`, which accepts a bare hyphen
 * anywhere — including at the start, at the end, or doubled. Five activities
 * reached production with slugs like:
 *
 *     /activity/catamaran-
 *     /activity/ghatha-resort-
 *     /activity/-desert-camp-full-day-trip-8-hours
 *     /activity/-public-al-safliya-island-water-sports-
 *
 * They render fine, so nothing looked broken, but they were submitted to Google
 * in the sitemap and read as sloppy in search results. Reported by the SEO team,
 * 2026-08-25.
 *
 * This pattern requires the slug to START and END with an alphanumeric and
 * allows single hyphens only BETWEEN segments — so `north-of-qatar-tour` is
 * fine while `-tour`, `tour-` and `north--tour` are rejected.
 *
 * Import this instead of writing the regex inline; six DTOs previously carried
 * their own copy and they would drift again the moment one was edited.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Shared message so the API answers identically wherever a slug is rejected. */
export const SLUG_MESSAGE =
  'URL slug may only contain lowercase letters, numbers and single hyphens between words (no leading, trailing or repeated hyphens)';
