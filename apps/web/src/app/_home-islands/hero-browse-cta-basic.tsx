'use client';

/**
 * Solid-pill "All Activities" CTA. CLIENT component (useTranslation) so the label
 * re-translates INSTANTLY on a language toggle. (Was server-rendered from the
 * lang cookie, but `/`'s `private, max-age=300` cache serves a stale RSC on
 * router.refresh, so it stayed in the old language after a switch — see
 * hero-title.tsx for the full explanation. DO NOT move back to server.)
 */

import Link from 'next/link';
import { useTranslation } from 'react-i18next';

export function HeroBrowseCtaBasic() {
  const { t } = useTranslation();
  return (
    <Link
      href="/explore"
      className="mt-10 inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-sky-700 shadow-md transition-colors hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
    >
      {t('footer.allActivities')}
    </Link>
  );
}
