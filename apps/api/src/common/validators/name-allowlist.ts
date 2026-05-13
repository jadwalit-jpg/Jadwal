/**
 * Character allow-lists for short identifier fields — country names, city
 * names, activity titles. Defence-in-depth on top of React's JSX text-node
 * auto-escaping (which protects against rendering raw HTML/JS from a
 * compromised admin write). The constraints below also reject characters
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

export const COUNTRY_NAME_REGEX = /^[\p{L}\p{M}0-9 \-'(),.]+$/u;
export const COUNTRY_NAME_MESSAGE =
  "Name may only contain letters, digits, spaces, and the punctuation - ' ( ) , .";

export const ACTIVITY_TITLE_REGEX = /^[\p{L}\p{M}0-9 \-'(),.+&:]+$/u;
export const ACTIVITY_TITLE_MESSAGE =
  "Title may only contain letters, digits, spaces, and the punctuation - ' ( ) , . + & :";
