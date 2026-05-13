/**
 * Hero h1 + subtitle — server component (no `'use client'`): renders the
 * translated copy from the lang cookie at request time, ships zero JS, paints
 * with the initial HTML. It used to be a client island so the title
 * re-translated synchronously on a language toggle — but `navbar.tsx`'s
 * `toggleLanguage` already calls `router.refresh()`, which re-renders this with
 * the new language; and since `/home` is edge-cached, that RSC refresh request
 * carries the updated `jadwal_lang` cookie so it bypasses the cache and gets a
 * fresh render. Moving it server-side removes a client component from `/home`'s
 * hydration — part of cutting mobile INP.
 *
 * LCP: the boat (`priority` Image) stays the preloaded LCP candidate; the h1
 * text is in the SSR'd HTML either way.
 */

import { readLangCookieServer } from '@/lib/lang-cookie.server';
import { getServerT } from '@/lib/i18n.server';

export async function HeroTitle() {
  const t = getServerT(await readLangCookieServer());
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
