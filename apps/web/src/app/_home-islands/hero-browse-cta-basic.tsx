/**
 * Solid-pill "All Activities" CTA — for `/home-test`. Lighter than the glass
 * `<HeroBrowseCta/>` used on `/home`: solid white bg, no `backdrop-blur`, no
 * `animate-bounce`. Matches the same "clean basic look" as `<NavbarBasic/>`'s
 * mobile menu rows (solid bg, dark text, no glass). Server-rendered (reads the
 * lang cookie, translates the label via `getServerT`); ships zero JS.
 */

import Link from 'next/link';
import { readLangCookieServer } from '@/lib/lang-cookie.server';
import { getServerT } from '@/lib/i18n.server';

export async function HeroBrowseCtaBasic() {
  const t = getServerT(await readLangCookieServer());
  return (
    <Link
      href="/explore"
      className="mt-10 inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-sky-700 shadow-md transition-colors hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
    >
      {t('footer.allActivities')}
    </Link>
  );
}
