import type { Metadata } from 'next';

/**
 * Public root `/` — Coming Soon launch page.
 *
 * Pure static SSR; no client interactivity, no fetch, no navbar/footer.
 * The full marketplace homepage now lives at `/home` (noindex) for
 * internal QA. When we're ready to launch publicly, swap this file's
 * default export for the one in `/home/page.tsx` (or just delete this
 * file and rename the directory).
 *
 * Animation is driven by a Tailwind arbitrary keyframe (no JS) and
 * respects `prefers-reduced-motion` via `motion-reduce:animate-none`.
 */

export const metadata: Metadata = {
  title: 'Jadwal — Coming Soon',
  description:
    'Jadwal is launching soon — the GCC marketplace for booking activities and experiences. Stay tuned.',
  openGraph: {
    title: 'Jadwal — Coming Soon',
    description:
      'Jadwal is launching soon — the GCC marketplace for booking activities and experiences.',
    type: 'website',
    siteName: 'Jadwal',
    url: '/',
    locale: 'en_US',
    alternateLocale: ['ar_QA'],
    images: [
      {
        url: '/android-chrome-512x512.png',
        width: 512,
        height: 512,
        alt: 'Jadwal',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Jadwal — Coming Soon',
    description:
      'Jadwal is launching soon — the GCC marketplace for booking activities and experiences.',
    images: ['/android-chrome-512x512.png'],
  },
};

export default function ComingSoonPage() {
  return (
    <main className="fixed inset-0 flex items-center justify-center bg-black overflow-hidden">
      {/* Subtle radial vignette so the centered content has depth. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(40,40,40,0.4)_0%,#000_70%)]"
      />

      <div className="relative flex items-center justify-center w-[min(80vw,560px)] aspect-square">
        {/*
         * Spinning circular arrow.
         * - SVG outer dimension fills the wrapper.
         * - The whole <svg> rotates via Tailwind animate-spin keyframes,
         *   slowed to 6s linear for a calm sweep instead of the default 1s.
         * - `stroke-dasharray` paints the segmented look from the reference
         *   image; the arrowhead is a separate <polygon> sitting at the
         *   start of the stroke so it rotates with the dashes.
         * - GPU-composited (transform only); no layout reflow.
         */}
        <svg
          aria-hidden="true"
          viewBox="0 0 200 200"
          className="absolute inset-0 h-full w-full text-white animate-[spin_6s_linear_infinite] motion-reduce:animate-none"
        >
          <circle
            cx="100"
            cy="100"
            r="78"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="2 6 4 8 6 10 8 12 10 14 14 18 22 26 36 30"
            pathLength="320"
            opacity="0.85"
          />
          {/* Arrowhead positioned at angle ~210° around the center (8 o'clock).
              Coordinates derived from r=78 + a small offset so the tip points
              tangent-inward, matching the reference. */}
          <polygon
            points="32,140 50,128 50,152"
            fill="currentColor"
            opacity="0.95"
          />
        </svg>

        {/* Center label */}
        <div className="relative z-10 flex flex-col items-center gap-3 text-white select-none">
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold tracking-[0.08em] text-center leading-[1.05]">
            COMING
            <br />
            SOON
          </h1>
          <div className="flex items-center gap-1.5 mt-1" aria-hidden="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <span
                key={i}
                className="block h-1 w-1 rounded-full bg-white/55"
              />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
