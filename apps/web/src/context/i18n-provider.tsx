'use client';

import { createContext, useCallback, useContext, useLayoutEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { I18nextProvider } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import i18n, { type Lang, isLang, readLangCookieClient } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Wraps the app with react-i18next + a shared language switcher.
 *
 * `initialLang` is read server-side by the root layout from a cookie and
 * passed here. We synchronise the i18next singleton to that value BEFORE
 * children render so server HTML and the first client hydration render
 * resolve the same `t()` strings — zero hydration mismatch.
 */

interface LangSwitchValue {
  /** Switch the UI language; masks the RSC refresh with a blur + spinner. */
  switchLanguage: (lng: Lang) => void;
  /** True while the post-switch RSC refresh is in flight. */
  isSwitching: boolean;
}

const LangSwitchContext = createContext<LangSwitchValue>({
  switchLanguage: () => {},
  isSwitching: false,
});

/** Shared language switcher — consumed by the navbar, vendor sidebar, etc. */
export function useLangSwitch(): LangSwitchValue {
  return useContext(LangSwitchContext);
}

export function I18nProvider({
  children,
  initialLang,
}: {
  children: React.ReactNode;
  initialLang?: Lang;
}) {
  const desired = isLang(initialLang) ? initialLang : readLangCookieClient();
  const router = useRouter();
  const [isSwitching, startTransition] = useTransition();

  // SSR: render this request's language WITHOUT mutating the shared module
  // singleton. The server is ONE Node process serving concurrent requests off a
  // single i18n instance; calling i18n.changeLanguage() during render lets one
  // request's language leak into another rendering at the same instant (an EN
  // request could flip the singleton mid-render of a concurrent AR request, and
  // vice-versa). Instead, each SSR render gets its own short-lived clone fixed to
  // `desired` (resources are shared, so it's cheap). The CLIENT keeps using the
  // singleton (synced by the layout effect below), so hydration still matches:
  // server HTML and first client render both resolve `desired`.
  const renderI18n =
    typeof window === 'undefined' && i18n.language !== desired
      ? i18n.cloneInstance({ lng: desired })
      : i18n;

  // Sync the i18n singleton to the server-resolved language, then mirror the
  // result onto <html lang dir>. This runs in a *layout* effect (before paint)
  // rather than during render: calling i18n.changeLanguage() during render is a
  // side effect, and under React 19 concurrent rendering / StrictMode the render
  // body can run multiple times before commit — each pass that saw a stale
  // singleton would fire changeLanguage() again, and because changeLanguage
  // synchronously emits `languageChanged`, every mounted useTranslation consumer
  // re-renders *mid-render*. Repeated language toggles compounded that into a
  // re-entrant render cascade — the "freeze after a few switches". A layout
  // effect fires once per commit, after the render is settled, so the sync is
  // idempotent and can't re-enter. It runs before the browser paints, so there
  // is no flash on the normal path.
  useLayoutEffect(() => {
    if (i18n.language !== desired) {
      // changeLanguage returns a promise but the in-memory switch is synchronous.
      void i18n.changeLanguage(desired);
    }
    document.documentElement.lang = i18n.language;
    document.documentElement.dir = i18n.language === 'ar' ? 'rtl' : 'ltr';
  }, [desired]);

  // The user-facing switch. Client text + <html dir/lang> flip synchronously
  // (instant, responsive), then the RSC refresh runs inside a transition so
  // `isSwitching` stays true until the new server-rendered islands commit — we
  // overlay a blur + spinner for that window so the brief lag isn't visible.
  // changeLanguage is called from this event handler (never during render), so
  // the freeze fix above is preserved.
  const switchLanguage = useCallback(
    (lng: Lang) => {
      if (lng === i18n.language) return;
      void i18n.changeLanguage(lng);
      startTransition(() => {
        router.refresh();
      });
    },
    [router],
  );

  return (
    <I18nextProvider i18n={renderI18n}>
      <LangSwitchContext.Provider value={{ switchLanguage, isSwitching }}>
        {children}
        {/* Language-switch mask: blurs the page + shows a spinner while the RSC
            refresh for the new language is in flight, hiding the brief lag.
            Always mounted for a smooth opacity transition; fully inert (no blur,
            click-through) when idle so it costs nothing the rest of the time. */}
        <div
          aria-hidden={!isSwitching}
          className={cn(
            'fixed inset-0 z-100 grid place-items-center transition-opacity duration-200',
            isSwitching
              ? 'opacity-100 bg-jadwal-bg/50 backdrop-blur-md'
              : 'pointer-events-none opacity-0',
          )}
        >
          {isSwitching && (
            <div role="status" aria-live="polite" className="flex flex-col items-center gap-3">
              <Loader2 className="h-9 w-9 animate-spin text-jadwal-accent" />
              <span className="sr-only">
                {i18n.language === 'ar' ? 'جارٍ تغيير اللغة' : 'Switching language'}
              </span>
            </div>
          )}
        </div>
      </LangSwitchContext.Provider>
    </I18nextProvider>
  );
}
