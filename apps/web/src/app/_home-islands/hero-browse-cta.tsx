/**
 * Hero CTA — server component (no `'use client'`): renders the translated
 * label from the lang cookie, ships zero JS. Sits between HeroTrustMetrics and
 * the boat, inside the hero's padded zone (`pb-56 md:pb-64`) so it never
 * overlaps the boat / sun / moon / cloud / wave layers. The pill bounces via
 * Tailwind's `animate-bounce` (CSS keyframes — no JS); clicking navigates to
 * /explore. `next/link` works fine in server components.
 */

import Link from 'next/link';
import { readLangServer } from '@/lib/lang-cookie.server';
import { localePath } from '@/lib/locale-path';
import { getServerT } from '@/lib/i18n.server';

export async function HeroBrowseCta() {
  const lang = await readLangServer();
  const t = getServerT(lang);
  return (
    <Link
      href={localePath('/explore', lang)}
      className="mt-10 inline-flex animate-bounce items-center justify-center rounded-full border border-white/30 bg-white/10 px-6 py-3 text-sm font-semibold text-white shadow-[0_4px_16px_-4px_rgba(15,23,42,0.25)] backdrop-blur-md transition-colors hover:border-white/50 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      {t('footer.allActivities')}
    </Link>
  );
}
