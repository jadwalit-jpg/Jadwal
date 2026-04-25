'use client';

import { useEffect, useRef } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n, { type Lang, isLang, readLangCookieClient } from '@/lib/i18n';

/**
 * Wraps the app with react-i18next.
 *
 * `initialLang` is read server-side by the root layout from a cookie and
 * passed here. We synchronise the i18next singleton to that value BEFORE
 * children render so server HTML and the first client hydration render
 * resolve the same `t()` strings — zero hydration mismatch.
 *
 * On cold client boot (i18n singleton was just initialised), i18n.language
 * is already the cookie value because lib/i18n.ts reads the same cookie.
 * But during bundler HMR / client-side nav the singleton may be stale, so
 * we double-check via a synchronous changeLanguage() call.
 */
export function I18nProvider({
  children,
  initialLang,
}: {
  children: React.ReactNode;
  initialLang?: Lang;
}) {
  const desired = isLang(initialLang) ? initialLang : readLangCookieClient();

  // Sync i18n synchronously (not inside useEffect) so children see the
  // correct translations from their very first render — no flash, no
  // mismatch. Guarded by a ref so we only do it once per provider lifetime.
  const syncedRef = useRef(false);
  if (!syncedRef.current && i18n.language !== desired) {
    // i18n.changeLanguage returns a promise but the in-memory switch is
    // synchronous — next `t()` call uses the new language on the same tick.
    void i18n.changeLanguage(desired);
  }
  syncedRef.current = true;

  // Keep <html lang dir> in sync with the runtime value. Cheap, idempotent.
  useEffect(() => {
    document.documentElement.lang = i18n.language;
    document.documentElement.dir = i18n.language === 'ar' ? 'rtl' : 'ltr';
  }, []);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
