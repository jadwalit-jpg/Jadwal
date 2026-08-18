import { cookies, headers } from 'next/headers';
import { isLang, type Lang, LANG_COOKIE, LANG_HEADER, DEFAULT_LANG } from './lang-cookie';

/**
 * Resolve the SSR language for the current request. The `x-lang` header is set
 * by the middleware from the URL (`/ar/...` → 'ar') and is the source of truth
 * for public localized routes. Falls back to the language cookie (for non-
 * localized routes like /admin, and before the middleware runs in dev). This is
 * what layout.tsx + the home islands use so server HTML matches the URL's
 * language and the client hydration (which also reads the same value).
 */
export async function readLangServer(): Promise<Lang> {
  const hdrs = await headers();
  const fromHeader = hdrs.get(LANG_HEADER);
  if (isLang(fromHeader)) return fromHeader;
  return readLangCookieServer();
}

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
