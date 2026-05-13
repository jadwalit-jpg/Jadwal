/**
 * Eyebrow for the home hero — server component (no `'use client'`): renders a
 * fixed string from the lang cookie ("Qatar · Local experiences" /
 * "قطر · تجارب محلية"), ships zero JS, paints with the initial HTML.
 *
 * It used to be a client component that prepended the IP-detected country —
 * but the country only resolves *post-hydration* (localStorage / /geo/detect),
 * so on the (edge-cached) page it visibly flashed "Local experiences in the
 * Gulf" → "Qatar · Local experiences" on every load. The platform is
 * Qatar-only and the cached HTML is one-size-fits-all, so a single
 * server-rendered string is correct and flicker-free. (Multi-country later →
 * revisit; you'd cache `/home` per-country or move the prefix client-side again.)
 *
 * `min-h-5` is kept (one line of text-xs/text-sm) — harmless now there's no
 * fill-in, and cheap insurance against any future RTL/font reflow.
 */

import { readLangCookieServer } from '@/lib/lang-cookie.server';

export async function HeroEyebrow() {
  const lang = await readLangCookieServer();
  const text = lang === 'ar' ? 'قطر · تجارب محلية' : 'Qatar · Local experiences';
  return (
    <p className="text-xs sm:text-sm font-semibold ltr:tracking-[0.2em] ltr:uppercase text-white/85 mb-4 drop-shadow min-h-5">
      {text}
    </p>
  );
}
