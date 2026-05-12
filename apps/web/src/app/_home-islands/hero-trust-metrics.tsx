'use client';

/**
 * Trust-metrics row for the home hero. Static numbers — no count-up
 * animation (it added 4 IntersectionObservers + a rAF loop to the hero
 * for no real benefit, and read as jittery on mobile). Stays a client
 * component only because the labels come from the i18n singleton, so they
 * re-translate synchronously on a language toggle.
 */

import { useTranslation } from 'react-i18next';
import { ShieldCheck, Star, Users, Headphones } from 'lucide-react';

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
