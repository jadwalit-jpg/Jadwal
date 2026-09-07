/**
 * Display helpers for activity location text.
 *
 * WHY THIS EXISTS
 * ---------------
 * `Activity.locationAddress` is free text the vendor types. In practice many
 * vendors paste the raw coordinates straight out of the map picker, so the
 * stored value is literally "25.2973927, 51.5500061". On 2026-09-07 every
 * activity on the Qatar explore page rendered that way: six cards, six pairs
 * of numbers, no place name anywhere.
 *
 * It is also a SINGLE string with no Arabic counterpart, so it can never be
 * localized — an Arabic visitor saw the English (or numeric) value either way.
 * `Activity.city` carries `nameEn`/`nameAr` and is the field that translates,
 * which is why the shared ActivityCard on the home page has always shown the
 * city and looked correct while the pages with their own inline card markup
 * did not.
 *
 * So: prefer `city` for a short card label, prefer a REAL address on a detail
 * page (where precision is the point), and in both cases refuse to print a
 * bare coordinate pair at a customer.
 */

/**
 * Matches a string that is nothing but a "lat, lng" pair.
 *
 * Anchored at both ends and capped at three integer digits, so it only ever
 * fires on a bare coordinate pair and leaves real addresses that merely
 * contain numbers alone:
 *
 *   "25.2973927, 51.5500061" -> suppressed (this is the bug)
 *   "25.2972, 51.5506"       -> suppressed
 *   "Box Park"               -> kept
 *   "Building 25, Street 51" -> kept (does not start with a number)
 *   "12, 34 Al Sadd Street"  -> kept (trailing text defeats the end anchor)
 */
const COORDINATE_PAIR = /^\s*-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?\s*$/;

/**
 * Returns the address only if it is something a human can read as a place.
 * A bare coordinate pair comes back as `null` so callers can fall through to
 * the city name (or, on the detail page, to the map that is already there).
 */
export function displayableAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  return COORDINATE_PAIR.test(value) ? null : value;
}
