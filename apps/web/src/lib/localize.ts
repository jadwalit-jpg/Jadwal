import i18n from '@/lib/i18n';

/**
 * Pick the correct localized field from a bilingual object.
 *
 * Usage:
 *   localized(activity, 'title')   → activity.titleEn or activity.titleAr
 *   localized(category, 'name')    → category.nameEn or category.nameAr
 *   localized(country, 'name')     → country.nameEn or country.nameAr
 *
 * Falls back to English if the Arabic field is empty/null.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function localized(obj: any, field: string): string {
  if (!obj) return '';
  const lang = i18n.language;

  if (lang === 'ar') {
    const arVal = obj[`${field}Ar`];
    if (typeof arVal === 'string' && arVal.trim()) return arVal;
  }

  const enVal = obj[`${field}En`];
  return typeof enVal === 'string' ? enVal : '';
}

/** Returns true when the current language is RTL (Arabic) */
export function isRtl(): boolean {
  return i18n.language === 'ar';
}
