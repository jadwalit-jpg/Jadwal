'use client';

/**
 * Trust-metrics row for the home hero. CLIENT component (useTranslation) so the
 * labels re-translate INSTANTLY on a language toggle. (Was a server component
 * reading the lang cookie, but `/`'s `private, max-age=300` cache serves a stale
 * RSC on router.refresh, so the labels stayed in the old language after a switch
 * — see hero-title.tsx for the full explanation. DO NOT move back to server.)
 * lucide-react icons are plain SVGs; static numbers stay inline.
 */

import { ShieldCheck, Star, Users, Headphones } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function HeroTrustMetrics() {
  const { t } = useTranslation();
  return (
    <div className="mt-10 flex flex-wrap items-center justify-center gap-6 md:gap-10">
      <div className="flex items-center gap-2 text-sm text-white/80">
        <ShieldCheck className="h-4 w-4 text-amber-300/90" />
        <span>50+ {t('home.verifiedPartners')}</span>
      </div>
      <div className="flex items-center gap-2 text-sm text-white/80">
        <Star className="h-4 w-4 text-amber-300/90" />
        <span>4.8/5 {t('home.averageRating')}</span>
      </div>
      <div className="flex items-center gap-2 text-sm text-white/80">
        <Users className="h-4 w-4 text-amber-300/90" />
        <span>2,000+ {t('home.bookings')}</span>
      </div>
      <div className="flex items-center gap-2 text-sm text-white/80">
        <Headphones className="h-4 w-4 text-amber-300/90" />
        <span>{t('home.qatarSupport')}</span>
      </div>
    </div>
  );
}
