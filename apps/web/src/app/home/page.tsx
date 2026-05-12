import { Metadata } from 'next';
import Image from 'next/image';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import { HeroEyebrow } from '../_home-islands/hero-eyebrow';
import { HeroTitle } from '../_home-islands/hero-title';
import { HeroSearchBar } from '../_home-islands/hero-search-bar';
import { HeroTrustMetrics } from '../_home-islands/hero-trust-metrics';
import { HeroBrowseCta } from '../_home-islands/hero-browse-cta';
import HomeBelowFoldLoader from '../_home-islands/home-below-fold-loader';

export const metadata: Metadata = {
  title: 'Jadwal — Discover & Book Experiences in Qatar',
  description:
    'Find and book the best activities, tours, and experiences across Qatar. 50+ verified partners, instant confirmation, and 24/7 support.',
  keywords: [
    'Qatar activities',
    'book experiences Qatar',
    'tours Qatar',
    'things to do in Qatar',
    'Doha activities',
    'Jadwal',
  ],
  openGraph: {
    title: 'Jadwal — Discover & Book Experiences in Qatar',
    description:
      'Discover activities, tours, and experiences across Qatar. Instant confirmation. 50+ verified partners.',
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
    title: 'Jadwal — Discover & Book Experiences in Qatar',
    description:
      'Discover activities, tours, and experiences across Qatar. Instant confirmation. 50+ verified partners.',
    images: ['/android-chrome-512x512.png'],
  },
  // /home is the staged preview route while the public root `/` shows the
  // Coming Soon page. Hide it from search engines so the live preview
  // doesn't get indexed alongside (or before) the Coming Soon launch page.
  robots: { index: false, follow: false },
};

/**
 * Home page — server-rendered shell.
 *
 * 2026-04-26: split out of the previous all-client `home-client.tsx`.
 * The static visual scaffolding (sky / sun / moon / glow / clouds /
 * waves / boat) renders as RSC HTML so the boat (priority Image) and
 * the painted background reach the screen on the first server
 * response instead of waiting for the QueryProvider / I18nProvider /
 * AuthProvider chain to hydrate.
 *
 * All translatable copy (eyebrow / title / subtitle / search /
 * metrics) lives in client islands under `_home-islands/`. They share
 * the i18n singleton from the providers in the root layout, so a
 * language toggle updates them synchronously — no router.refresh()
 * round-trip required for the translated strings on this route.
 */
export default function Page() {
  return (
    <div className="relative min-h-screen bg-jadwal-bg font-outfit">
      <Navbar />

      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden min-h-svh flex flex-col">
        {/* Sky gradient — day/night based on theme. */}
        <div className="absolute inset-0 bg-linear-to-b from-[#1a3a5c] via-[#2a6496] to-[#4ab0d8] dark:from-[#0a0f1a] dark:via-[#111827] dark:to-[#1e3a5f]" />

        {/* Sun (light mode). */}
        <div className="dark:hidden absolute top-20 sm:top-28 md:top-32 right-[12%] z-6 pointer-events-none">
          <div className="hero-sun-glow absolute -inset-16 sm:-inset-20 bg-amber-300/30 rounded-full blur-[60px]" />
          <div className="hero-sun-glow absolute -inset-8 sm:-inset-10 bg-yellow-200/40 rounded-full blur-[30px]" />
          <div className="hero-sun relative">
            <svg
              width="90"
              height="90"
              viewBox="0 0 100 100"
              className="w-16 h-16 sm:w-20 sm:h-20 md:w-[90px] md:h-[90px] drop-shadow-[0_0_30px_rgba(251,191,36,0.6)]"
            >
              <g opacity="0.5">
                {Array.from({ length: 12 }).map((_, i) => (
                  <line
                    key={i}
                    x1="50"
                    y1="5"
                    x2="50"
                    y2="15"
                    stroke="#FCD34D"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    transform={`rotate(${i * 30} 50 50)`}
                  />
                ))}
              </g>
              <circle cx="50" cy="50" r="24" fill="url(#sunGrad)" />
              <ellipse
                cx="43"
                cy="43"
                rx="8"
                ry="6"
                fill="white"
                opacity="0.3"
                transform="rotate(-20 43 43)"
              />
              <defs>
                <radialGradient id="sunGrad" cx="45%" cy="40%">
                  <stop offset="0%" stopColor="#FEF08A" />
                  <stop offset="60%" stopColor="#FBBF24" />
                  <stop offset="100%" stopColor="#F59E0B" />
                </radialGradient>
              </defs>
            </svg>
          </div>
        </div>

        {/* PERF TEST 2026-05-12 — moon (dark mode) temporarily removed to
            measure its contribution to mobile /home render cost. REVERT this
            commit when the test is done (do not re-type the SVG by hand). */}

        {/* Glow blob behind hero text. */}
        <div className="absolute top-16 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-amber-300/20 dark:bg-blue-400/10 rounded-full blur-[100px] pointer-events-none" />

        {/* PERF TEST 2026-05-12 — the 5 drifting cloud <img>s temporarily
            removed to measure their contribution to mobile /home render cost.
            REVERT this commit when the test is done. */}

        {/* Hero content. Static markup; only the search bar + trust metrics
            below are client islands.
            Mobile spacing: navbar (variant="transparent" by default on /)
            sits over the hero, so without explicit pt- the eyebrow line
            ("QATAR · LOCAL EXPERIENCES") collides with the bottom edge of
            the navbar on small viewports. pt-16 / sm:pt-20 lifts the centered
            content block clear of the navbar; md+ resets to pt-0 so larger
            screens (where the navbar is shorter relative to the viewport)
            keep the original visually-centered layout.
            Boat / sun / moon / waves are positioned absolutely against the
            section, NOT inside this content block, so they stay put. */}
        <div className="relative z-20 flex-1 flex flex-col items-center justify-center max-w-6xl mx-auto w-full px-6 pt-16 sm:pt-20 md:pt-0 pb-56 md:pb-64 text-center">
          {/*
            Letter-spacing & text-balance modifiers are scoped to `ltr:` so
            they only apply on Latin layouts. Reasons:
              - Arabic is cursive — letter-spacing (positive OR negative)
                breaks the ligatures and forces the shaper to re-resolve
                connections on every paint, which on mobile + small
                viewports surfaces as a sub-pixel "shake".
              - `text-balance` on cursive Arabic h1s causes the browser
                balancer to oscillate (it tries to find an optimal break
                where Latin metrics no longer apply).
            Net effect: identical behavior on English; stable hero on Arabic.
          */}
          <HeroEyebrow />
          <HeroTitle />

          <HeroSearchBar />
          <HeroTrustMetrics />
          <HeroBrowseCta />
        </div>

        {/* PERF TEST 2026-05-12 — the wave SVGs (2 light + 2 dark, 200%-wide,
            bézier paths) temporarily removed to measure their contribution to
            mobile /home render cost. REVERT this commit when the test is done. */}

        {/* Boat — split into TWO divs so the centering transform
            (`-translate-x-1/2`) and the float animation (`hero-boat`)
            don't collide on the same element. CSS animations override
            any matching `transform` properties, so when both classes
            sat on one div the centering was being clobbered every
            animation frame and the boat wandered ~half-its-width to
            the right. The outer div now owns positioning + centering;
            the inner div owns the animation. `priority` flags the
            boat as an LCP candidate so Next.js preloads it. */}
        <div className="absolute bottom-10 md:bottom-14 left-1/2 -translate-x-1/2 z-20 w-28 sm:w-36 md:w-44 pointer-events-none">
          <div className="hero-boat">
            <Image
              src="/images/userhero/boat.svg"
              alt=""
              width={144}
              height={72}
              priority
              unoptimized
              className="w-full h-auto drop-shadow-[0_4px_20px_rgba(0,0,0,0.3)] dark:invert dark:opacity-80"
            />
          </div>
        </div>
      </section>

      {/* Hero → content seam */}
      <div className="relative -mt-1 z-30">
        <div className="absolute inset-0 bg-linear-to-b from-[#87D6F7] to-jadwal-bg dark:from-[#0d1b2e] dark:to-jadwal-bg pointer-events-none" />
        <svg
          className="relative block w-full h-[40px] md:h-[60px]"
          viewBox="0 0 1200 120"
          preserveAspectRatio="none"
        >
          <path
            d="M0,0 C150,80 350,0 600,40 C850,80 1050,0 1200,40 L1200,120 L0,120 Z"
            className="fill-jadwal-bg"
          />
        </svg>
      </div>

      <HomeBelowFoldLoader />

      <Footer />
    </div>
  );
}
