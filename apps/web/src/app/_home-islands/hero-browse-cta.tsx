'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';

/**
 * Hero CTA island. Sits between HeroTrustMetrics and the boat — entirely
 * inside the hero's padded zone (`pb-56 md:pb-64`) so it never touches the
 * boat / sun / moon / cloud / wave layers. Pill itself bounces (Tailwind's
 * default 1s animate-bounce so the @keyframes bounce rule is guaranteed
 * to ship); clicking navigates to /explore.
 */
export function HeroBrowseCta() {
  const { t } = useTranslation();

  return (
    <Link
      href="/explore"
      className="mt-10 inline-flex animate-bounce items-center justify-center rounded-full border border-white/30 bg-white/10 px-6 py-3 text-sm font-semibold text-white shadow-[0_4px_16px_-4px_rgba(15,23,42,0.25)] backdrop-blur-md transition-colors hover:border-white/50 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      {t('footer.allActivities')}
    </Link>
  );
}
