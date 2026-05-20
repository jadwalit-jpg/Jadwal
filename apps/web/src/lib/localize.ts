import i18n from '@/lib/i18n';

/**
 * Pick the correct localized field from a bilingual object.
 *
 * Usage:
 *   localized(activity, 'title')   → activity.titleEn or activity.titleAr
 *   localized(category, 'name')    → category.nameEn or category.nameAr
 *   localized(country, 'name')     → country.nameEn or country.nameAr
 *   localized(extraService, 'name') → extraService.nameAr or extraService.name
 *                                     (Activity.extraServices JSON: existing
 *                                     items have plain `name`, new ones can
 *                                     carry both `name` (English) + `nameAr`.)
 *
 * Resolution order:
 *   - Arabic locale: `${field}Ar` (if non-empty) → `${field}En` → `${field}`
 *   - English locale:                              `${field}En` → `${field}`
 *
 * The fall-through to the unsuffixed `${field}` makes the helper compatible
 * with the JSON-stored extras shape (which uses `name` as the stable
 * booking-time identifier and never had an `En` suffix).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function localized(obj: any, field: string): string {
  if (!obj) return '';
  const lang = i18n.language;

  if (lang === 'ar') {
    const arVal = obj[`${field}Ar`];
    if (typeof arVal === 'string' && arVal.trim()) return arVal;
  }

  // Only return a non-empty `${field}En` here — if it's the empty string,
  // fall through to the unsuffixed `${field}` so a legacy row that has the
  // English suffix as '' but a real value in `${field}` (e.g. JSON extras)
  // still renders. Empty AR strings are already handled above via .trim().
  const enVal = obj[`${field}En`];
  if (typeof enVal === 'string' && enVal) return enVal;
  const plain = obj[field];
  return typeof plain === 'string' ? plain : '';
}

/** Returns true when the current language is RTL (Arabic) */
export function isRtl(): boolean {
  return i18n.language === 'ar';
}
