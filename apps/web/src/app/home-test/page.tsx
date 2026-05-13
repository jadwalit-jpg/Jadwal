import { Metadata } from 'next';
import Image from 'next/image';
import Footer from '@/components/footer';
import { NavbarBasic } from '@/components/navbar-basic';
import { HeroEyebrow } from '../_home-islands/hero-eyebrow';
import { HeroTitle } from '../_home-islands/hero-title';
import { HeroSearchBar } from '../_home-islands/hero-search-bar';
import { HeroTrustMetrics } from '../_home-islands/hero-trust-metrics';
import { HeroBrowseCtaBasic } from '../_home-islands/hero-browse-cta-basic';
import HomeBelowFoldLoader from '../_home-islands/home-below-fold-loader';

/**
 * `/home-test` — a slimmed copy of `/home`, kept for ongoing perf testing.
 * NOT linked anywhere; noindex.
 *
 * Same data + same job: same `<HeroSearchBar/>`, same SSR'd `<HeroTitle/>` /
 * `<HeroTrustMetrics/>`, same `<HomeBelowFoldLoader/>` (geo-scoped via the same
 * GeoProvider). Same root-layout providers as everything else.
 *
 * Different from `/home`:
 *  - `<NavbarBasic/>` (overlay, transparent over hero, scroll-to-opaque past the
 *    hero) instead of the full `<Navbar/>` (no notification bell, no user
 *    dropdown, no auth-loading skeleton, no admin/vendor button, no glass).
 *  - Hero decorations: sun (light) / moon (dark) with the same glow halos and
 *    drop-shadow as `/home`, **3 clouds** instead of 5 (the larger ones), the
 *    boat, and the waves — all the same SVGs and the same CSS animations as
 *    `/home` (boat-float, wave-drift, cloud-drift-mid) from `globals.css`. No
 *    `blur-[100px]` glow blob behind the text — we still skip that one.
 *  - The dynamic country-detecting `<HeroEyebrow/>` is here (`/home-test` isn't
 *    edge-cached, so no flash concern from caching).
 *  - Lighter solid-pill CTA (`<HeroBrowseCtaBasic/>`) — no glass, no
 *    `animate-bounce`.
 */
export const metadata: Metadata = {
  title: 'Jadwal — /home perf test build',
  robots: { index: false, follow: false },
};

export default function HomeTestPage() {
  return (
    <div className="relative min-h-screen bg-jadwal-bg font-outfit">
      <NavbarBasic />

      <section className="relative overflow-hidden min-h-svh flex flex-col bg-linear-to-b from-[#1a3a5c] via-[#2a6496] to-[#4ab0d8] dark:from-[#0a0f1a] dark:via-[#111827] dark:to-[#1e3a5f]">
        {/* Sun (light mode) — same shape as `/home`, with the two static glow
            halos (`hero-sun-glow` resting opacities defined in globals.css —
            no animation, just a soft amber bloom around the disk) and the
            same `drop-shadow-[0_0_30px_rgba(251,191,36,0.6)]` warm spill on
            the SVG itself. The inner `.hero-sun` wrapper is `relative` so the
            disk paints above the absolutely-positioned halos behind it. */}
        <div aria-hidden="true" className="dark:hidden absolute top-20 sm:top-28 md:top-32 right-[12%] z-6 pointer-events-none">
          <div className="hero-sun-glow absolute -inset-16 sm:-inset-20 bg-amber-300/30 rounded-full blur-[60px]" />
          <div className="hero-sun-glow absolute -inset-8 sm:-inset-10 bg-yellow-200/40 rounded-full blur-[30px]" />
          <div className="hero-sun relative">
            <svg
              focusable="false"
              width="90"
              height="90"
              viewBox="0 0 100 100"
              className="w-16 h-16 sm:w-20 sm:h-20 md:w-[90px] md:h-[90px] drop-shadow-[0_0_30px_rgba(251,191,36,0.6)]"
            >
              <g opacity="0.5">
                {Array.from({ length: 12 }).map((_, i) => (
                  <line key={i} x1="50" y1="5" x2="50" y2="15" stroke="#FCD34D" strokeWidth="2.5" strokeLinecap="round" transform={`rotate(${i * 30} 50 50)`} />
                ))}
              </g>
              <circle cx="50" cy="50" r="24" fill="url(#htSunGrad)" />
              <ellipse cx="43" cy="43" rx="8" ry="6" fill="white" opacity="0.3" transform="rotate(-20 43 43)" />
              <defs>
                <radialGradient id="htSunGrad" cx="45%" cy="40%">
                  <stop offset="0%" stopColor="#FEF08A" />
                  <stop offset="60%" stopColor="#FBBF24" />
                  <stop offset="100%" stopColor="#F59E0B" />
                </radialGradient>
              </defs>
            </svg>
          </div>
        </div>

        {/* Moon (dark mode) — same pattern as Sun but cooler tones: two static
            `hero-moon-glow` halos in blue/slate, and a slate `drop-shadow` on
            the disk for the night-sky bloom. */}
        <div aria-hidden="true" className="hidden dark:block absolute top-20 sm:top-28 md:top-32 right-[12%] z-6 pointer-events-none">
          <div className="hero-moon-glow absolute -inset-16 sm:-inset-20 bg-blue-300/15 rounded-full blur-[60px]" />
          <div className="hero-moon-glow absolute -inset-8 sm:-inset-10 bg-slate-200/10 rounded-full blur-[30px]" />
          <svg
            focusable="false"
            width="80"
            height="80"
            viewBox="0 0 100 100"
            className="relative w-14 h-14 sm:w-[72px] sm:h-[72px] md:w-20 md:h-20 drop-shadow-[0_0_25px_rgba(148,163,184,0.4)]"
          >
            <circle cx="50" cy="50" r="28" fill="url(#htMoonGrad)" />
            <circle cx="62" cy="40" r="22" fill="#111827" />
            <circle cx="40" cy="55" r="4" fill="#CBD5E1" opacity="0.15" />
            <circle cx="48" cy="65" r="2.5" fill="#CBD5E1" opacity="0.1" />
            <circle cx="35" cy="45" r="2" fill="#CBD5E1" opacity="0.12" />
            <circle cx="15" cy="20" r="1.2" fill="white" opacity="0.7" />
            <circle cx="80" cy="75" r="1" fill="white" opacity="0.5" />
            <circle cx="25" cy="80" r="0.8" fill="white" opacity="0.4" />
            <circle cx="78" cy="18" r="1.5" fill="white" opacity="0.6" />
            <circle cx="10" cy="60" r="0.7" fill="white" opacity="0.3" />
            <defs>
              <radialGradient id="htMoonGrad" cx="40%" cy="40%">
                <stop offset="0%" stopColor="#F1F5F9" />
                <stop offset="50%" stopColor="#CBD5E1" />
                <stop offset="100%" stopColor="#94A3B8" />
              </radialGradient>
            </defs>
          </svg>
        </div>

        {/* 3 clouds — the larger ones from `/home`. `dir="ltr"` for the same
            reason as `/home`: the cloud-drift translateX is LTR-relative. */}
        <div aria-hidden="true" dir="ltr" className="absolute inset-0 z-5 pointer-events-none overflow-hidden">
          <div className="hero-cloud-slow absolute top-[10%] left-[3%]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/userhero/cloud.svg"
              alt=""
              width={279}
              height={181}
              className="w-36 sm:w-44 md:w-52 opacity-25 dark:opacity-10 invert"
            />
          </div>
          <div className="hero-cloud-mid absolute top-[18%] left-1/2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/userhero/cloud.svg"
              alt=""
              width={279}
              height={181}
              className="w-28 sm:w-36 md:w-44 opacity-20 dark:opacity-8 invert scale-x-[-1]"
            />
          </div>
          <div className="hero-cloud-fast absolute top-[6%] left-[70%]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/userhero/cloud.svg"
              alt=""
              width={279}
              height={181}
              className="w-20 sm:w-24 md:w-28 opacity-15 dark:opacity-6 invert"
            />
          </div>
        </div>

        {/* Hero content. Same pt/pb scale as `/home` (`pt-16 sm:pt-20 md:pt-0
            pb-56 md:pb-64`): the asymmetric bottom padding lifts the centered
            block well above the waves and the boat at the bottom of the
            section, on every breakpoint. On md+ we drop pt to 0 so the
            content centers naturally in the larger viewport. */}
        <div className="relative z-20 flex-1 flex flex-col items-center justify-center max-w-6xl mx-auto w-full px-6 pt-16 sm:pt-20 md:pt-0 pb-56 md:pb-64 text-center">
          <HeroEyebrow />
          <HeroTitle />
          <HeroSearchBar />
          <HeroTrustMetrics />
          <HeroBrowseCtaBasic />
        </div>

        {/* Waves (light) */}
        <div aria-hidden="true" dir="ltr" className="dark:hidden absolute bottom-0 inset-x-0 z-10 pointer-events-none overflow-hidden">
          <svg focusable="false" className="w-[200%] h-24 md:h-32 hero-wave-slow opacity-50" viewBox="0 0 2400 120" preserveAspectRatio="none">
            <path d="M0,40 C200,0 400,80 600,40 C800,0 1000,80 1200,40 C1400,0 1600,80 1800,40 C2000,0 2200,80 2400,40 L2400,120 L0,120 Z" fill="#87D6F7" />
          </svg>
        </div>
        <div aria-hidden="true" dir="ltr" className="dark:hidden absolute bottom-0 inset-x-0 z-10 pointer-events-none overflow-hidden">
          <svg focusable="false" className="w-[200%] h-20 md:h-28 hero-wave" viewBox="0 0 2400 120" preserveAspectRatio="none">
            <path d="M0,30 C200,100 400,20 600,60 C800,100 1000,30 1200,70 C1400,100 1600,30 1800,60 C2000,100 2200,30 2400,70 L2400,120 L0,120 Z" fill="#3FC8F4" />
            <path d="M0,60 C150,90 350,50 600,80 C850,100 1050,50 1200,80 C1400,100 1600,50 1800,80 C2050,100 2200,60 2400,80 L2400,120 L0,120 Z" fill="#00B9F1" />
          </svg>
        </div>

        {/* Waves (dark) */}
        <div aria-hidden="true" dir="ltr" className="hidden dark:block absolute bottom-0 inset-x-0 z-10 pointer-events-none overflow-hidden">
          <svg focusable="false" className="w-[200%] h-24 md:h-32 hero-wave-slow opacity-50" viewBox="0 0 2400 120" preserveAspectRatio="none">
            <path d="M0,40 C200,0 400,80 600,40 C800,0 1000,80 1200,40 C1400,0 1600,80 1800,40 C2000,0 2200,80 2400,40 L2400,120 L0,120 Z" fill="#1e3a5f" />
          </svg>
        </div>
        <div aria-hidden="true" dir="ltr" className="hidden dark:block absolute bottom-0 inset-x-0 z-10 pointer-events-none overflow-hidden">
          <svg focusable="false" className="w-[200%] h-20 md:h-28 hero-wave" viewBox="0 0 2400 120" preserveAspectRatio="none">
            <path d="M0,30 C200,100 400,20 600,60 C800,100 1000,30 1200,70 C1400,100 1600,30 1800,60 C2000,100 2200,30 2400,70 L2400,120 L0,120 Z" fill="#1e3a5f" />
            <path d="M0,60 C150,90 350,50 600,80 C850,100 1050,50 1200,80 C1400,100 1600,50 1800,80 C2050,100 2200,60 2400,80 L2400,120 L0,120 Z" fill="#162d4a" />
          </svg>
        </div>

        {/* Boat — same split-div pattern as `/home` (outer owns centering;
            inner owns the float animation, so the two transforms don't fight). */}
        <div aria-hidden="true" className="absolute bottom-10 md:bottom-14 left-1/2 -translate-x-1/2 z-20 w-28 sm:w-36 md:w-44 pointer-events-none">
          <div className="hero-boat">
            <Image
              src="/images/userhero/boat.svg"
              alt=""
              width={144}
              height={72}
              priority
              unoptimized
              className="w-full h-auto dark:invert dark:opacity-80"
            />
          </div>
        </div>
      </section>

      <HomeBelowFoldLoader />
      <Footer />
    </div>
  );
}
