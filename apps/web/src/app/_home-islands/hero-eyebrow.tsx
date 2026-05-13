/**
 * Eyebrow for the home hero — server component now.
 *
 * Reads `CF-IPCountry` from the request headers Cloudflare attaches to every
 * request that reaches the origin (or `Cf-Ipcountry`, depending on the lib's
 * casing), maps the ISO code to a localized country name, and renders the
 * eyebrow text server-side. Removes the "flash" the old client version had
 * where the text flipped from "Local experiences in the Gulf" →
 * "Qatar · Local experiences" once `useGeo()` resolved.
 *
 * Cache-key note (S3, swap-day): when this page goes behind an edge-cache
 * Rule, the cached HTML carries whichever `CF-IPCountry` the first
 * cache-populator's request had. For Qatar-first launch (most prod traffic
 * is QA-based) this is fine — the cached eyebrow text matches the
 * majority country. If we ever need true per-country cached HTML, the
 * cache key must include the country header (Cloudflare Cache Rule:
 * `Cache Key → Custom Cache Key → Header → cf-ipcountry`). For now the
 * single-country cache is the right trade-off.
 *
 * The country-name strings are hard-coded for the GCC + a few common visitor
 * countries — small, stable, fixed list. A DB lookup at SSR time would be
 * the more "general" approach but would block every page render on a Prisma
 * round-trip just to translate one ISO code; the hard-coded map is
 * effectively free.
 */

import { headers } from 'next/headers';
import { readLangCookieServer } from '@/lib/lang-cookie.server';

// Country-code → localized name. Covers GCC + the visitor countries we
// expect the most. Anything outside this map falls back to the no-country
// gulf-experience line, which is correct behavior for unknown audiences.
const COUNTRY_NAMES: Record<string, { en: string; ar: string }> = {
  QA: { en: 'Qatar', ar: 'قطر' },
  SA: { en: 'Saudi Arabia', ar: 'السعودية' },
  AE: { en: 'United Arab Emirates', ar: 'الإمارات' },
  KW: { en: 'Kuwait', ar: 'الكويت' },
  BH: { en: 'Bahrain', ar: 'البحرين' },
  OM: { en: 'Oman', ar: 'عُمان' },
};

export async function HeroEyebrow() {
  const hdrs = await headers();
  // Cloudflare's header. Two casings are the same value, but Next normalizes
  // to lowercase get-by-name — using the canonical lowercase form.
  const countryCode = (hdrs.get('cf-ipcountry') ?? '').toUpperCase();
  const lang = await readLangCookieServer();
  const isAr = lang === 'ar';

  const name = COUNTRY_NAMES[countryCode]?.[isAr ? 'ar' : 'en'];
  const text = isAr
    ? name
      ? `${name} · تجارب محلية`
      : 'تجارب محلية في الخليج'
    : name
      ? `${name} · Local experiences`
      : 'Local experiences in the Gulf';

  return (
    // `data-eyebrow="country"` is the stable selector the nonce-injector Worker
    // uses to rewrite this element's text per-request from `CF-IPCountry`.
    // Free-plan Cloudflare can't put a header in the cache key, so the cached
    // HTML's country would otherwise be frozen to whichever country the cache-
    // populator was in — the Worker rewrite restores per-visitor accuracy on
    // top of the cache HIT. Removing the attribute is the kill switch (the
    // Worker's `on('p[data-eyebrow="country"]', …)` then matches nothing and
    // the server-rendered text shows through).
    <p
      data-eyebrow="country"
      className="text-xs sm:text-sm font-semibold ltr:tracking-[0.2em] ltr:uppercase text-white/85 mb-4 drop-shadow min-h-5"
    >
      {text}
    </p>
  );
}
