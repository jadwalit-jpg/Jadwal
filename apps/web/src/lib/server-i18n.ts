/**
 * Server-side translation helper — a "next-intl-light" for the rare cases
 * where we need to render translated text in a Server Component.
 *
 * Why: react-i18next is a client-only library — its hooks don't work on
 * the server. For text that is the LCP element on a page (e.g. the h1 on
 * /login or /register), we can't wait for client hydration to render the
 * heading, because that's exactly what makes LCP slow.
 *
 * This helper reads the `jadwal_lang` cookie (set by the language toggle),
 * loads the matching locale JSON at build time via static import, and does
 * a dot-path lookup. Returns the translated string or the key itself as a
 * last-resort fallback (matching react-i18next behaviour).
 *
 * USE SPARINGLY. The full app uses react-i18next; only adopt serverT() on
 * specific Server Components that need to render translated text in HTML
 * before hydration. Anywhere a `'use client'` component already calls
 * `useTranslation()` it should keep doing that — there's no advantage to
 * mixing.
 *
 * Lang resolution:
 *   - Cookie absent → 'en' (matches the default in I18nProvider)
 *   - Cookie 'ar'   → 'ar'
 *   - Anything else → 'en'
 */

import { cookies } from 'next/headers';
import en from '@/locales/en.json';
import ar from '@/locales/ar.json';

type Locale = 'en' | 'ar';
type Dict = Record<string, unknown>;

const LOCALES: Record<Locale, Dict> = {
  en: en as Dict,
  ar: ar as Dict,
};

function dotLookup(dict: Dict, path: string): string | undefined {
  let cur: unknown = dict;
  for (const part of path.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as Dict)) {
      cur = (cur as Dict)[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

export async function getServerLang(): Promise<Locale> {
  const store = await cookies();
  const value = store.get('jadwal_lang')?.value;
  return value === 'ar' ? 'ar' : 'en';
}

/**
 * Lookup a translation key for the current request's lang cookie.
 * Server Components can call this directly; Client Components must keep
 * using `useTranslation()` from react-i18next.
 */
export async function serverT(key: string, fallback?: string): Promise<string> {
  const lang = await getServerLang();
  const dict = LOCALES[lang];
  const value = dotLookup(dict, key);
  return value ?? fallback ?? key;
}

/**
 * Synchronous variant when you already know the lang (e.g. you've already
 * called `getServerLang()` once at the top of the page). Cheaper than calling
 * serverT() for every single key.
 */
export function tFor(lang: Locale, key: string, fallback?: string): string {
  const dict = LOCALES[lang];
  const value = dotLookup(dict, key);
  return value ?? fallback ?? key;
}
