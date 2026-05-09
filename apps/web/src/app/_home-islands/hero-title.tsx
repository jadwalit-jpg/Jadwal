'use client';

/**
 * Hero h1 + subtitle island. Originally rendered as RSC (read from the
 * lang cookie at request time) but that meant the title only re-translated
 * after a router.refresh() round-trip when the user toggled language —
 * visibly slower than the rest of the hero (eyebrow / search / metrics)
 * which all update synchronously off the i18n singleton. Moving these
 * two strings to a client island makes the language switch feel uniform.
 *
 * Note on LCP: the boat (`priority` Image) is preloaded so it remains an
 * LCP candidate; the brief hydration wait on this h1 doesn't dominate
 * the metric on broadband, and on slow mobile the priority preload still
 * wins the race.
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
