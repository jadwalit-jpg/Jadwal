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
 * Returns `AR` when the highest-priority language tag is Arabic, else `EN`.
 * Missing / malformed headers fall back to `EN`.
 */
export function resolveLanguageFromRequest(
  req?: { headers?: Record<string, unknown> } | null,
): EmailLanguage {
  const raw = req?.headers?.['accept-language'];
  if (typeof raw !== 'string' || raw.trim().length === 0) return 'EN';
  // "ar-QA,ar;q=0.9,en;q=0.8" → the first comma-segment is the preferred tag.
  const firstTag = raw.split(',')[0]?.trim().toLowerCase() ?? '';
  return firstTag.startsWith('ar') ? 'AR' : 'EN';
}
