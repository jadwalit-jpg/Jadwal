'use client';

/**
 * Eyebrow for the home hero. Reads the detected country from the geo
 * context and prepends its name ("Qatar · Local experiences"). The
 * country resolves async so this is a client component — the parent
 * RSC reserves the line height so the layout doesn't shift when geo
 * resolves (was the source of the original "shake" on /).
 *
 * `min-h-5 sm:min-h-[1.25rem]` reserves one line of `text-xs`/`text-sm`
 * so first paint has the right footprint even before the country name
 * fills in. On a hard refresh the geo query usually resolves in ~150ms
 * — well under the eye's flicker threshold once the line height is
 * already reserved.
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
