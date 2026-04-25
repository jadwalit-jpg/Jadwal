import { cookies } from 'next/headers';
import { isLang, type Lang, LANG_COOKIE, DEFAULT_LANG } from './lang-cookie';

/**
 * Read the current user's language preference from the request cookie during
 * server-side rendering. Server component only — `next/headers` is not
 * available to client components. Callers: app/layout.tsx (to set
 * <html lang dir>) and the I18nProvider boundary (to pass initialLang prop).
 *
 * Returns 'en' when the cookie is missing or has an invalid value so the
 * default locale is predictable.
 */
export async function readLangCookieServer(): Promise<Lang> {
  const store = await cookies();
  const raw = store.get(LANG_COOKIE)?.value;
  return isLang(raw) ? raw : DEFAULT_LANG;
}
