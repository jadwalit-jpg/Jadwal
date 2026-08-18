/**
 * Character allow-lists for short identifier fields — country names, city
 * names, activity titles. Defence-in-depth on top of React's JSX text-node
 * auto-escaping (which protects against rendering raw HTML/JS from a
 * compromised admin write). The constraints below also reject characters
 *
 * Added 2026-05-13 (PR #245 — backend audit-finding follow-up).
 * that look like HTML/JS injection, so a tampered DB row never gets the
 * chance to ride through to the client.
 *
 * Two tiers:
 *
 *   COUNTRY_NAME_REGEX — strictest. Letters (any script via `\p{L}`),
 *     combining marks (`\p{M}` — needed for `عُمان` damma and decomposed
 *     `Côte d'Ivoire` accents), digits, literal space, and the small set
 *     of real-world punctuation in country names: `-`, `'`, `(`, `)`, `,`,
 *     `.`. Used by Country + City DTOs (both are short, name-like fields).
 *
 *   ACTIVITY_TITLE_REGEX — slightly more permissive: same set as above
 *     plus `+`, `&`, `:`. Real-world activity titles often have
 *     "Desert Safari + BBQ Dinner", "Royal Falconry: Desert Edition",
 *     "Tea & Dates Experience" — the country regex would reject those.
 *     Still blocks `<`, `>`, `=`, `/`, `;`, `{`, `}` (HTML/JS-shaped).
 *
 * Both are anchored (`^…$`) and require at least one character (`+`).
 * `MinLength(1)` on the DTO is the empty-string check; these regexes
 * focus on the *shape* of allowed input.
 */

// Both patterns lead with a positive lookahead `(?=.*[\p{L}0-9])` — without it,
// strings of only spaces / punctuation / combining marks would pass (the
// trailing `+` quantifier just requires *one* allowed character, and spaces
// are allowed). The lookahead forces *at least one* real letter or digit in
// the value, rejecting blank-looking input like `"   "` or `"----"` upstream
// of `@MinLength(1)`.
export const COUNTRY_NAME_REGEX = /^(?=.*[\p{L}0-9])[\p{L}\p{M}0-9 \-'(),.]+$/u;
export const COUNTRY_NAME_MESSAGE =
  "Name may only contain letters, digits, spaces, and the punctuation - ' ( ) , .";

export const ACTIVITY_TITLE_REGEX = /^(?=.*[\p{L}0-9])[\p{L}\p{M}0-9 \-'(),.+&:]+$/u;
export const ACTIVITY_TITLE_MESSAGE =
  "Title may only contain letters, digits, spaces, and the punctuation - ' ( ) , . + & :";

// ── Language-specific business/display names ──────────────────────────────────
// The generic patterns above use `\p{L}` (letters of ANY script), so they can't
// tell an English field from an Arabic one. These two DO: the "(English)" field
// must be LATIN script, the "(Arabic)" field must contain Arabic script. This
// stops Arabic text landing in the English business-name field (which also
// breaks the auto-generated URL slug) and vice-versa. Same punctuation set as
// ACTIVITY_TITLE; leading lookahead forces at least one real letter/digit.

// English name — Latin script only (covers accented Latin: Café, Côte). Rejects
// Arabic/Cyrillic/etc.
export const BUSINESS_NAME_EN_REGEX = /^(?=.*[\p{Script=Latin}0-9])[\p{Script=Latin}\p{M}0-9 \-'(),.+&:]+$/u;
export const BUSINESS_NAME_EN_MESSAGE =
  'English business name must use English/Latin letters — Arabic text is not allowed here (use the Arabic name field).';

// Arabic name — must contain at least one Arabic-script letter. Latin/digits are
// still allowed for mixed brand names (e.g. "مطعم Pizza").
export const BUSINESS_NAME_AR_REGEX = /^(?=.*\p{Script=Arabic})[\p{L}\p{M}0-9 \-'(),.+&:]+$/u;
export const BUSINESS_NAME_AR_MESSAGE =
  'Arabic business name must include Arabic text (use the English name field for English).';
