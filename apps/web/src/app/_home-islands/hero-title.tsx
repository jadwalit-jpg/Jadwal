'use client';

/**
 * Hero h1 + subtitle. CLIENT component (useTranslation) so it re-translates
 * INSTANTLY when the language is toggled.
 *
 * It was briefly a server component (read the `jadwal_lang` cookie + getServerT)
 * to shave hydration JS — but that has a language-toggle bug: `/` is cached
 * (`private, max-age=300`, see middleware.ts) and that cache does NOT vary on the
 * cookie, so the `router.refresh()` a toggle fires gets served the STALE
 * old-language RSC. The server-rendered hero therefore stayed in the previous
 * language after a switch, while the rest of the site (client-translated) updated
 * fine. Rendering client-side re-renders from i18n state on `languageChanged`,
 * with no cache/refresh dependency. The text is still in the SSR HTML (client
 * components are server-rendered), so SEO/LCP are unaffected — the boat Image
 * stays the LCP candidate. DO NOT move this back to a server component.
 */

import { useTranslation } from 'react-i18next';

export function HeroTitle() {
  const { t } = useTranslation();
  return (
    <>
      <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-semibold ltr:tracking-[-1.2px] text-white leading-[1.05] max-w-4xl mx-auto drop-shadow-lg ltr:text-balance">
        {t('home.heroTitle1')}{' '}
        <span className="text-amber-200 drop-shadow-md">
          {t('home.heroTitle2')}
        </span>
      </h1>
      {/* Subtitle hidden below `sm` (640px) — on mobile the title +
          search bar already convey the value prop and the smaller
          viewport reads more cleanly without the extra paragraph. */}
      <p className="mt-5 hidden sm:block text-base md:text-lg text-white/80 max-w-2xl mx-auto leading-relaxed">
        {t('home.heroSubtitle')}
      </p>
    </>
  );
}
