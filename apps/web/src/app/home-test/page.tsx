import { Metadata } from 'next';
import Footer from '@/components/footer';
import { NavbarBasic } from '@/components/navbar-basic';
import { HeroEyebrow } from '../_home-islands/hero-eyebrow';
import { HeroTitle } from '../_home-islands/hero-title';
import { HeroSearchBar } from '../_home-islands/hero-search-bar';
import { HeroTrustMetrics } from '../_home-islands/hero-trust-metrics';
import HomeBelowFoldLoader from '../_home-islands/home-below-fold-loader';

/**
 * `/home-test` — a deliberately-stripped clone of `/home`, for diagnosing the
 * mobile slowness. NOT a replacement for `/home`; not linked anywhere; noindex.
 *
 * Same data + same job: it reuses the same `<HeroSearchBar/>` (interactive
 * search), the same SSR'd `<HeroTitle/>` / `<HeroTrustMetrics/>`, the same
 * `<HomeBelowFoldLoader/>` (Featured / Trending / Near-You / categories, geo-
 * scoped via the same `GeoProvider`/`/geo/detect`). It also still runs under
 * the same root layout (the QueryProvider / I18nProvider / ThemeProvider /
 * AuthProvider / ToastProvider / CustomerShell→GeoProvider chain).
 *
 * What's different from `/home`:
 *   1. `<NavbarBasic/>` instead of the full `<Navbar/>` (no scroll variant, no
 *      notification bell, no user dropdown, no glass — ~1/5th the code).
 *   2. A plain hero — a solid CSS gradient, NO SVG sky/sun/moon/clouds/waves/
 *      boat, NO CSS animations, NO `backdrop-blur`. Far fewer DOM nodes.
 *   3. No footer.
 *
 * The test: load this on a phone next to `/home` and compare how fast the
 * navbar/menu/theme buttons become responsive after the page paints.
 *   - If `/home-test` is clearly snappier → the cost is the full navbar + the
 *     SVG-heavy hero DOM → keep slimming those.
 *   - If it's about the same → the cost is the shared layout providers / the
 *     below-fold chunk + queries → that's the deeper fix.
 * (Note: `/home-test` is NOT edge-cached, so its TTFB will be slower than
 *  `/home`'s ~50 ms HIT — judge the *interactivity-after-paint*, not the TTFB.)
 */
export const metadata: Metadata = {
  title: 'Jadwal — /home perf test build',
  robots: { index: false, follow: false },
};

export default function HomeTestPage() {
  return (
    <div className="relative min-h-screen bg-jadwal-bg font-outfit">
      <NavbarBasic />
      {/* Plain hero — solid CSS gradient only; no SVG decorations, no animations. */}
      <section className="relative min-h-svh flex flex-col items-center justify-center bg-linear-to-b from-[#1a3a5c] via-[#2a6496] to-[#4ab0d8] dark:from-[#0a0f1a] dark:via-[#111827] dark:to-[#1e3a5f] px-6 pt-24 pb-16 text-center">
        <div className="relative z-10 max-w-6xl mx-auto w-full">
          <HeroEyebrow />
          <HeroTitle />
          <HeroSearchBar />
          <HeroTrustMetrics />
        </div>
      </section>
      <HomeBelowFoldLoader />
      <Footer />
    </div>
  );
}
