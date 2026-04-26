'use client';

/**
 * Trust-metrics island for the home hero. Counters animate on scroll-in
 * via Framer's useInView. Extracted from home-client.tsx (2026-04-26) so
 * the rest of the hero can render as RSC.
 */

import { useTranslation } from 'react-i18next';
import { ShieldCheck, Star, Users, Headphones } from 'lucide-react';
import { AnimatedCounter } from '@/components/animated-counter';

export function HeroTrustMetrics() {
  const { t } = useTranslation();
  return (
    <div className="mt-10 flex flex-wrap items-center justify-center gap-6 md:gap-10">
      <div className="flex items-center gap-2 text-sm text-white/80">
        <ShieldCheck className="h-4 w-4 text-amber-300/90" />
        <span>
          <AnimatedCounter value={50} suffix="+" /> {t('home.verifiedPartners')}
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm text-white/80">
        <Star className="h-4 w-4 text-amber-300/90" />
        <span>
          <AnimatedCounter value={4.8} decimals={1} />/5 {t('home.averageRating')}
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm text-white/80">
        <Users className="h-4 w-4 text-amber-300/90" />
        <span>
          <AnimatedCounter value={2000} suffix="+" /> {t('home.bookings')}
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm text-white/80">
        <Headphones className="h-4 w-4 text-amber-300/90" />
        <span>{t('home.qatarSupport')}</span>
      </div>
    </div>
  );
}
