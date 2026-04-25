/**
 * Pure constants + type guards for the language cookie. NO imports from
 * react-i18next or i18next here — those pull `createContext` which is not
 * available to React Server Components. Keep this module server-safe so
 * layout.tsx can import it from the server side.
 */

export const LANG_COOKIE = 'jadwal_lang';
export const LANG_STORAGE_KEY = 'jadwal_lang';

export type Lang = 'en' | 'ar';
export const SUPPORTED_LANGS: Lang[] = ['en', 'ar'];

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'ar';
}

/** Default language when no cookie is present. */
export const DEFAULT_LANG: Lang = 'en';
