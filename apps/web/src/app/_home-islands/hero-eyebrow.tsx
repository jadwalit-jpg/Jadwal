'use client';

/**
 * Eyebrow for the home hero — the country-detecting version: it reads the
 * detected country from the geo context and prepends its name ("Saudi Arabia ·
 * Local experiences" / "قطر · تجارب محلية"). The country resolves async, so
 * this is a client component; `min-h-5` reserves one line of `text-xs`/`text-sm`
 * so the layout doesn't shift when it fills in. On a hard refresh the country
 * is restored from localStorage in ~the first frame after hydration (see
 * geo-context.tsx), so the no-country fallback ("Local experiences in the Gulf")
 * shows only briefly. `suppressHydrationWarning` because SSR has no `country`.
 *
 * Currently used on /home-test only. (It's *not* on /home because /home is
 * edge-cached one-size-fits-all — a cached copy can't carry the visitor's
 * country, so on /home this would flash the fallback → country on every load.)
 */

import { useTranslation } from 'react-i18next';
import { useGeo } from '@/context/geo-context';
import { localized } from '@/lib/localize';

export function HeroEyebrow() {
  const { i18n } = useTranslation();
  const { country } = useGeo();
  const isRtl = i18n.language === 'ar';

  const countryName = country ? localized(country, 'name') : '';
  const text = isRtl
    ? countryName
      ? `${countryName} · تجارب محلية`
      : 'تجارب محلية في الخليج'
    : countryName
      ? `${countryName} · Local experiences`
      : 'Local experiences in the Gulf';

  return (
    <p
      className="text-xs sm:text-sm font-semibold ltr:tracking-[0.2em] ltr:uppercase text-white/85 mb-4 drop-shadow min-h-5"
      suppressHydrationWarning
    >
      {text}
    </p>
  );
}
