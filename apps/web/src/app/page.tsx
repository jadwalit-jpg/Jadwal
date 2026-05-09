import type { Metadata } from 'next';

/**
 * Public root `/` — Coming Soon launch page.
 *
 * Pure static SSR; no client interactivity, no fetch, no navbar/footer.
 * The full marketplace homepage now lives at `/home` (noindex) for
 * internal QA. When ready to launch publicly, swap this file's default
 * export for the one in `/home/page.tsx`.
 *
 * Animation strategy: each letter uses Tailwind's built-in `animate-bounce`
 * utility (definitely emits `@keyframes bounce` because it's also used in
 * the hero CTA), with a per-letter `[animation-delay:NNNms]` arbitrary
 * value to stagger the bounces and produce a wave across the wordmark.
 * No custom @keyframes or globals.css additions — everything ships through
 * Tailwind's normal JIT pipeline so there's no risk of a missing keyframe
 * silently no-op'ing the animation.
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
      {/* Subtle radial vignette for depth. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(40,40,40,0.4)_0%,#000_70%)]"
      />

      <div className="relative flex flex-col items-center justify-center px-6 select-none">
        {/* aria-label exposes the phrase "Coming Soon" to assistive tech;
            individual letter spans are aria-hidden so screen readers
            don't announce them one at a time. Each letter ships with a
            distinct literal Tailwind class string so the JIT emits both
            animate-bounce and the per-letter [animation-delay:Nms] rules. */}
        <h1
          aria-label="Coming Soon"
          className="text-4xl sm:text-6xl md:text-7xl font-bold tracking-[0.12em] text-white text-center leading-[1.1]"
        >
          <span aria-hidden="true" className="inline-block animate-bounce [animation-delay:0ms]">C</span>
          <span aria-hidden="true" className="inline-block animate-bounce [animation-delay:80ms]">O</span>
          <span aria-hidden="true" className="inline-block animate-bounce [animation-delay:160ms]">M</span>
          <span aria-hidden="true" className="inline-block animate-bounce [animation-delay:240ms]">I</span>
          <span aria-hidden="true" className="inline-block animate-bounce [animation-delay:320ms]">N</span>
          <span aria-hidden="true" className="inline-block animate-bounce [animation-delay:400ms]">G</span>
          <span aria-hidden="true" className="inline-block w-[0.4em]">&nbsp;</span>
          <span aria-hidden="true" className="inline-block animate-bounce [animation-delay:480ms]">S</span>
          <span aria-hidden="true" className="inline-block animate-bounce [animation-delay:560ms]">O</span>
          <span aria-hidden="true" className="inline-block animate-bounce [animation-delay:640ms]">O</span>
          <span aria-hidden="true" className="inline-block animate-bounce [animation-delay:720ms]">N</span>
        </h1>
        <div className="flex items-center gap-1.5 mt-6" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className="block h-1 w-1 rounded-full bg-white/55" />
          ))}
        </div>
      </div>
    </main>
  );
}
