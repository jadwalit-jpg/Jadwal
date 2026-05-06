import { Metadata } from 'next';
import Image from 'next/image';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import { HeroEyebrow } from './_home-islands/hero-eyebrow';
import { HeroTitle } from './_home-islands/hero-title';
import { HeroSearchBar } from './_home-islands/hero-search-bar';
import { HeroTrustMetrics } from './_home-islands/hero-trust-metrics';
import HomeBelowFoldLoader from './_home-islands/home-below-fold-loader';

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

        {/* Moon (dark mode). */}
        <div className="hidden dark:block absolute top-20 sm:top-28 md:top-32 right-[12%] z-6 pointer-events-none">
          <div className="hero-moon-glow absolute -inset-16 sm:-inset-20 bg-blue-300/15 rounded-full blur-[60px]" />
          <div className="hero-moon-glow absolute -inset-8 sm:-inset-10 bg-slate-200/10 rounded-full blur-[30px]" />
          <svg
            width="80"
            height="80"
            viewBox="0 0 100 100"
            className="w-14 h-14 sm:w-[72px] sm:h-[72px] md:w-20 md:h-20 drop-shadow-[0_0_25px_rgba(148,163,184,0.4)]"
          >
            <circle cx="50" cy="50" r="28" fill="url(#moonGrad)" />
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
              <radialGradient id="moonGrad" cx="40%" cy="40%">
                <stop offset="0%" stopColor="#F1F5F9" />
                <stop offset="50%" stopColor="#CBD5E1" />
                <stop offset="100%" stopColor="#94A3B8" />
              </radialGradient>
            </defs>
          </svg>
        </div>

        {/* Glow blob behind hero text. */}
        <div className="absolute top-16 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-amber-300/20 dark:bg-blue-400/10 rounded-full blur-[100px] pointer-events-none" />

        {/* Clouds — drift via CSS `hero-cloud-*` keyframes.
            `dir="ltr"` is mandatory: the cloud animations use
            translateX(NNvw) and the children are absolutely positioned
            with `left-[N%]`. Inside a `dir="rtl"` document, the browser
            treats those positions as RTL-relative for overflow / hit-
            testing purposes, and on mobile (where `vw`-based translations
            push the clouds near or past the viewport edge) this triggers
            continuous sub-pixel layout recalculation that surfaces as a
            "shake" of the entire hero content area. The sibling wave
            blocks already use the same trick for the same reason. */}
        <div dir="ltr" className="absolute inset-0 z-5 pointer-events-none overflow-hidden">
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
          <div className="hero-cloud-slow absolute top-[28%] left-[25%]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/userhero/cloud.svg"
              alt=""
              width={279}
              height={181}
              className="w-24 sm:w-28 md:w-36 opacity-12 dark:opacity-5 invert scale-x-[-1]"
            />
          </div>
          <div className="hero-cloud-mid absolute top-[4%] left-[35%]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/userhero/cloud.svg"
              alt=""
              width={279}
              height={181}
              className="w-16 sm:w-20 md:w-24 opacity-10 dark:opacity-4 invert"
            />
          </div>
        </div>

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
        </div>

        {/* Waves (light) */}
        <div
          dir="ltr"
          className="dark:hidden absolute bottom-0 inset-x-0 z-10 pointer-events-none overflow-hidden"
        >
          <svg
            className="w-[200%] h-24 md:h-32 hero-wave-slow opacity-50"
            viewBox="0 0 2400 120"
            preserveAspectRatio="none"
          >
            <path
              d="M0,40 C200,0 400,80 600,40 C800,0 1000,80 1200,40 C1400,0 1600,80 1800,40 C2000,0 2200,80 2400,40 L2400,120 L0,120 Z"
              fill="#87D6F7"
            />
          </svg>
        </div>
        <div
          dir="ltr"
          className="dark:hidden absolute bottom-0 inset-x-0 z-10 pointer-events-none overflow-hidden"
        >
          <svg
            className="w-[200%] h-20 md:h-28 hero-wave"
            viewBox="0 0 2400 120"
            preserveAspectRatio="none"
          >
            <path
              d="M0,30 C200,100 400,20 600,60 C800,100 1000,30 1200,70 C1400,100 1600,30 1800,60 C2000,100 2200,30 2400,70 L2400,120 L0,120 Z"
              fill="#3FC8F4"
            />
            <path
              d="M0,60 C150,90 350,50 600,80 C850,100 1050,50 1200,80 C1400,100 1600,50 1800,80 C2050,100 2200,60 2400,80 L2400,120 L0,120 Z"
              fill="#00B9F1"
            />
          </svg>
        </div>

        {/* Waves (dark) */}
        <div
          dir="ltr"
          className="hidden dark:block absolute bottom-0 inset-x-0 z-10 pointer-events-none overflow-hidden"
        >
          <svg
            className="w-[200%] h-24 md:h-32 hero-wave-slow opacity-50"
            viewBox="0 0 2400 120"
            preserveAspectRatio="none"
          >
            <path
              d="M0,40 C200,0 400,80 600,40 C800,0 1000,80 1200,40 C1400,0 1600,80 1800,40 C2000,0 2200,80 2400,40 L2400,120 L0,120 Z"
              fill="#1e3a5f"
            />
          </svg>
        </div>
        <div
          dir="ltr"
          className="hidden dark:block absolute bottom-0 inset-x-0 z-10 pointer-events-none overflow-hidden"
        >
          <svg
            className="w-[200%] h-20 md:h-28 hero-wave"
            viewBox="0 0 2400 120"
            preserveAspectRatio="none"
          >
            <path
              d="M0,30 C200,100 400,20 600,60 C800,100 1000,30 1200,70 C1400,100 1600,30 1800,60 C2000,100 2200,30 2400,70 L2400,120 L0,120 Z"
              fill="#1e3a5f"
            />
            <path
              d="M0,60 C150,90 350,50 600,80 C850,100 1050,50 1200,80 C1400,100 1600,50 1800,80 C2050,100 2200,60 2400,80 L2400,120 L0,120 Z"
              fill="#162d4a"
            />
          </svg>
        </div>

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
