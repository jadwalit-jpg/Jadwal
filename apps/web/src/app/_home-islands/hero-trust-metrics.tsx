/**
 * Trust-metrics row for the home hero — server component (no `'use client'`):
 * static numbers + translated labels from the lang cookie, ships zero JS.
 * (lucide-react icons are plain SVG components with no client hooks — fine in
 * a server component.) No count-up animation (dropped in an earlier change —
 * it added IntersectionObservers + a rAF loop to the hero for no benefit).
 */

import { ShieldCheck, Star, Users, Headphones } from 'lucide-react';
import { readLangCookieServer } from '@/lib/lang-cookie.server';
import { getServerT } from '@/lib/i18n.server';

export async function HeroTrustMetrics() {
  const t = getServerT(await readLangCookieServer());
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
