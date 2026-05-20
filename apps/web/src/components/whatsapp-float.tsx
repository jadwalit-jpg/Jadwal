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

import { useTranslation } from 'react-i18next';
import { usePathname } from 'next/navigation';

// +974 7749 9399 with spaces stripped, no leading plus —
// wa.me expects digits only (E.164 minus the +).
const WHATSAPP_NUMBER = '97477499399';

export function WhatsAppFloat() {
  const { i18n } = useTranslation();
  const pathname = usePathname();
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
    : 'Hi, I have a question about Jadwal';

  const href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(greeting)}`;
  const label = isRtl ? 'تواصل معنا على واتساب' : 'Chat with us on WhatsApp';

  // Compose responsive visibility:
  //   - non-activity-detail: always show (`grid`).
  //   - activity-detail: hide on mobile/tablet, show on desktop (`hidden lg:grid`).
  const visibility = isActivityDetail ? 'hidden lg:grid' : 'grid';

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
        <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.017-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" />
      </svg>
    </a>
  );
}
