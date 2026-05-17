/**
 * Email language resolution.
 *
 * Jadwal sends transactional email in English or Arabic. Two signals feed
 * the choice (see EmailService.send): an explicit per-send locale, then the
 * recipient's stored `User.preferredLanguage`, then a hard default of EN.
 *
 * This helper derives the language from an incoming HTTP request's
 * `Accept-Language` header — used at registration to seed
 * `User.preferredLanguage`. It is a heuristic: a user can be given an
 * explicit preference toggle later without changing this code.
 */

/** The two supported email languages — mirrors the Prisma `Language` enum. */
export type EmailLanguage = 'EN' | 'AR';

/**
 * Pick the email language from a request's `Accept-Language` header.
 * Returns `AR` when the highest-`q`-weighted language tag is Arabic, else `EN`.
 * Missing / malformed headers fall back to `EN`.
 *
 * Honours RFC 9110 §12.5.4 quality weights: a tag with no explicit `q`
 * defaults to `q=1.0`, and on a tie the earliest-listed tag wins. So
 * `en;q=0.7,ar;q=1.0` correctly resolves to Arabic even though `en` is first.
 */
export function resolveLanguageFromRequest(
  req?: { headers?: Record<string, unknown> } | null,
): EmailLanguage {
  const raw = req?.headers?.['accept-language'];
  if (typeof raw !== 'string' || raw.trim().length === 0) return 'EN';

  let bestTag = '';
  let bestQ = -1;
  for (const segment of raw.split(',')) {
    const [tagPart, ...params] = segment.trim().split(';');
    const tag = tagPart.trim().toLowerCase();
    if (!tag) continue;
    let q = 1; // no explicit q → q=1.0
    for (const param of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(param);
      if (m) q = Number(m[1]);
    }
    // Strict `>` keeps the earliest tag on a q tie (RFC ordering).
    if (Number.isFinite(q) && q > bestQ) {
      bestQ = q;
      bestTag = tag;
    }
  }
  // Arabic = exact `ar` or a regional `ar-*` subtag (not a bare `startsWith`,
  // which would over-match any future `ar…` language code).
  return bestTag === 'ar' || bestTag.startsWith('ar-') ? 'AR' : 'EN';
}
