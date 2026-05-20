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
      <svg
        viewBox="0 0 32 32"
        aria-hidden="true"
        focusable="false"
        className="h-7 w-7 sm:h-8 sm:w-8 fill-white"
      >
        <path d="M19.11 17.205c-.372 0-1.088 1.39-1.518 1.39a.63.63 0 0 1-.315-.1c-.802-.402-1.504-.817-2.163-1.447-.545-.516-1.146-1.29-1.46-1.963a.426.426 0 0 1-.073-.215c0-.33.99-.945.99-1.49 0-.143-.73-2.09-.832-2.335-.143-.372-.214-.487-.6-.487-.187 0-.36-.043-.53-.043-.302 0-.53.115-.746.315-.688.645-1.032 1.318-1.06 2.264v.114c-.015.99.472 1.977 1.017 2.78 1.23 1.82 2.506 3.41 4.554 4.34.616.287 2.035.91 2.722.91.817 0 2.15-.487 2.49-1.245.115-.244.187-.516.187-.777 0-.187-.043-.387-.058-.59-.13-.31-.86-.605-1.16-.69zm-2.93 7.785c-1.466 0-2.905-.42-4.157-1.187l-.297-.176-3.06.802.83-2.987-.19-.31a8.067 8.067 0 0 1-1.232-4.302c0-4.5 3.667-8.166 8.166-8.166 4.502 0 8.182 3.682 8.182 8.182 0 4.5-3.66 8.146-8.16 8.146zm0-17.61c-5.215 0-9.443 4.226-9.443 9.444 0 1.625.464 3.13 1.273 4.504L7 27.385l5.668-1.482a9.408 9.408 0 0 0 4.512 1.143c5.215 0 9.443-4.226 9.443-9.442 0-5.232-4.228-9.46-9.443-9.46z" />
      </svg>
    </a>
  );
}
