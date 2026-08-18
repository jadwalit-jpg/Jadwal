import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en.json';
import ar from '@/locales/ar.json';
import {
  LANG_COOKIE,
  LANG_STORAGE_KEY as STORAGE_KEY,
  isLang,
  type Lang,
} from './lang-cookie';
import { isLocalizablePath } from './locale-path';

export { LANG_COOKIE, STORAGE_KEY, isLang };
export type { Lang };

/**
 * Read the language cookie on the client. Used for non-localized routes
 * (admin/vendor/…) where the UI language is the user's stored preference.
 */
export function readLangCookieClient(): Lang {
  if (typeof document === 'undefined') return 'en';
  const match = document.cookie.match(/(?:^|;\s*)jadwal_lang=(en|ar)/);
  return (match?.[1] as Lang) ?? 'en';
}

/**
 * Resolve the client language the SAME way the server does (see readLangServer):
 * the URL is the source of truth on public routes.
 *   - `/ar/...`            → 'ar'
 *   - public unprefixed    → 'en' (English lives at the root; the cookie only
 *                            drives the middleware redirect, never the rendered
 *                            language once you're on an unprefixed page)
 *   - non-localized routes → the cookie (admin/vendor/auth UI preference)
 * Keeping this identical to the server's resolution is what prevents hydration
 * mismatches now that language comes from the URL, not the cookie.
 */
export function readLangClient(): Lang {
  if (typeof window === 'undefined') return 'en';
  const path = window.location.pathname;
  if (path === '/ar' || path.startsWith('/ar/')) return 'ar';
  if (isLocalizablePath(path)) return 'en';
  return readLangCookieClient();
}

/**
 * Initialise i18next. On the server this runs once with whatever `lng` is
 * passed to changeLanguage() from the layout's cookies() read. On the client
 * it reads the cookie synchronously (same source of truth as server).
 */
i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: typeof document === 'undefined' ? 'en' : readLangClient(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

/**
 * Persist language choice. On change we write BOTH a cookie (so server can
 * read it on the next request) and localStorage (legacy, retained so in-
 * flight tabs keep working). Doc dir + lang attrs are applied to the live DOM.
 */
i18n.on('languageChanged', (lng) => {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, lng); } catch { /* private mode */ }
  // Cookie persistence: 1 year, root path, SameSite=Lax (survives top-level
  // nav + blocks third-party cross-site contexts). Not HttpOnly because the
  // client-side i18n init needs to read it synchronously to avoid a paint
  // flash on hard refresh. Secure flag set only over HTTPS so dev on
  // http://localhost still works. Cookie value is enum-bounded ('en'|'ar'),
  // no user-controlled content, so it's not an injection surface.
  const isSecure = window.location.protocol === 'https:';
  const flags = `path=/; max-age=31536000; samesite=lax${isSecure ? '; secure' : ''}`;
  document.cookie = `${LANG_COOKIE}=${lng}; ${flags}`;
  document.documentElement.lang = lng;
  document.documentElement.dir = lng === 'ar' ? 'rtl' : 'ltr';
});

export default i18n;
