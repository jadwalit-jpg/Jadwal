/**
 * Floating WhatsApp help button.
 *
 * Renders a fixed-position circular button in the bottom-corner that deep-links
 * to a wa.me chat with Jadwal support. `inset-e-*` is the RTL-aware logical
 * property — bottom-right in LTR, bottom-left in RTL.
 *
 * Responsive positioning:
 *   - Mobile (default): bottom = max(1rem, env(safe-area-inset-bottom)) →
 *     16px on devices with no home indicator, 34px on iPhones with the home
 *     indicator. inset-e-4 (16px from the corner). Icon is 48px → corner-
 *     anchored, never floats up into the hero content.
 *   - sm+ : bottom-6 (24px), inset-e-6 (24px), icon scales to 56px.
 *
 * Page-aware hiding:
 *   - /activity/[slug] on mobile/tablet has a `lg:hidden sticky bottom-0`
 *     Book Now bar (~70-80px tall). The icon would overlap the Book Now
 *     button. We hide it at < lg there; desktop has no bar, so the icon
 *     still shows.
 *
 * Stacking:
 *   - z-40 sits above the activity sticky bar (z-30) and below modals /
 *     push-prompt (z-50) and toasts (z-[100]). A toast briefly covers the
 *     icon during its 3-5s lifetime — accepted trade-off.
 *
 * Wired into CustomerShell so it auto-skips admin / vendor / auth routes
 * (same gating as GeoProvider). target="_blank" + rel="noopener noreferrer"
 * follows the project tabnabbing rule. The icon is an inline SVG of the
 * WhatsApp brand mark (an exception to the "Lucide only" rule — Lucide
 * doesn't ship third-party brand glyphs).
 */
'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePathname } from 'next/navigation';

// +974 7749 9399 with spaces stripped, no leading plus —
// wa.me expects digits only (E.164 minus the +).
const WHATSAPP_NUMBER = '97477499399';

export function WhatsAppFloat() {
  const { i18n } = useTranslation();
  const pathname = usePathname();
  // The href/aria-label/title are language-dependent, and the client i18n
  // language can differ from the SSR snapshot (cookie vs client detector),
  // which React can't patch on attributes → hydration error. Render this
  // floating CTA only after mount so server + first client render match.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isRtl = i18n.dir() === 'rtl';

  // Activity detail (`/activity/[slug]`) has a mobile-only sticky Book Now
  // bar; hide the icon at < lg there so it doesn't overlap the primary CTA.
  // Plain `/activity` (no slug) and `/activity/[slug]/book` keep the icon —
  // the book page has its own layout without the sticky bar.
  const isActivityDetail =
    !!pathname &&
    pathname.startsWith('/activity/') &&
    !pathname.endsWith('/book') &&
    pathname.split('/').filter(Boolean).length === 2;

  const greeting = isRtl
    ? 'مرحبًا، لدي سؤال بخصوص الجدول'
    : 'Hi, I have a question about AL Jadwal';

  const href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(greeting)}`;
  const label = isRtl ? 'تواصل معنا على واتساب' : 'Chat with us on WhatsApp';

  // Compose responsive visibility:
  //   - non-activity-detail: always show (`grid`).
  //   - activity-detail: hide on mobile/tablet, show on desktop (`hidden lg:grid`).
  const visibility = isActivityDetail ? 'hidden lg:grid' : 'grid';

  if (!mounted) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className={`
        ${visibility}
        fixed inset-e-4 sm:inset-e-6 z-40
        bottom-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-6
        h-12 w-12 sm:h-14 sm:w-14 place-items-center
        rounded-full bg-[#25D366]
        shadow-lg shadow-black/25
        transition-transform duration-200
        hover:scale-110
        focus-visible:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2
        active:scale-95
        motion-reduce:transition-none motion-reduce:hover:scale-100
      `}
    >
      {/*
        Canonical WhatsApp brand mark from Simple Icons (simpleicons.org,
        CC0). Cleaner curves + correct brand proportions vs. the prior
        custom path. ViewBox 24×24 is the brand-kit standard size.
      */}
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        className="h-7 w-7 sm:h-8 sm:w-8 fill-white"
      >
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
      </svg>
    </a>
  );
}
