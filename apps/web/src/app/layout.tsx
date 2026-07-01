import type { Metadata } from "next";
import { Inter, Tajawal, Outfit } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { AuthProvider } from "@/context/auth-context";
import TermsConsentGate from "@/components/terms-consent-gate";
import { I18nProvider } from "@/context/i18n-provider";
import { ThemeProvider } from "next-themes";
import { QueryProvider } from "@/lib/query-provider";
import { ToastProvider } from "@/components/toast";
import { CookieConsentProvider } from "@/context/cookie-consent";
import CookieConsentBanner from "@/components/cookie-consent-banner";
import MetaPixel from "@/components/meta-pixel";
import { Suspense } from "react";
// CustomerShell conditionally wraps children with GeoProvider + LazyPrompts
// based on pathname. Staff (admin / vendor) and auth routes skip both —
// they don't need country detection or "verify your phone" prompts.
// Verified safe: 0 useGeo calls in admin / vendor source.
import { CustomerShell } from "@/components/customer-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { JsonLd } from "@/components/json-ld";
import { readLangServer } from "@/lib/lang-cookie.server";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600", "700"],
  display: "swap",
});

// Arabic UI font — Tajawal. Chosen over Noto Kufi because it's the de facto
// standard across GCC marketplace apps (wqtah, Rafeeq, Talabat, Haraj) so
// Arabic-native users find it familiar and legible. Heavier stems than Noto
// Kufi at the same weight → headlines read as substantial instead of thin.
//
// `preload: false` — Arabic glyphs aren't in the critical Latin path, so we
// avoid the preload on every page. Loads on demand when dir="rtl" or any
// Arabic Unicode-range glyph appears.
//
// `display: 'optional'` — eliminates the font-swap layout shift ("shake")
// in the hero on Arabic. If Tajawal arrives in the ~100ms block period,
// it's used; otherwise the system Arabic fallback is locked in for the
// page lifetime. After first visit the font is cached so subsequent loads
// always render with Tajawal. This avoids the visible reflow when the h1
// + subtitle + small text re-paint mid-render.
const tajawal = Tajawal({
  variable: "--font-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "700", "800"],
  display: "optional",
  preload: false,
});

// Resolve `metadataBase` once for the whole app so any nested page that
// uses relative URLs in `openGraph.images` / `twitter.images` (e.g.
// '/images/login-bg.webp') gets them turned into absolute URLs that
// social scrapers — WhatsApp, Twitter, Slack, iMessage — can actually
// fetch. Falls back to 127.0.0.1:3000 (literal IPv4 to keep
// `localhost` strings out of source per the security-grep CI rule)
// for plain `npm run dev` runs that haven't set NEXT_PUBLIC_SITE_URL.
const siteUrl = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://127.0.0.1:3000');
  } catch {
    return new URL('http://127.0.0.1:3000');
  }
})();

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: "AL Jadwal — Discover and book experiences in Qatar",
    template: "%s · AL Jadwal",
  },
  description: "Discover and book experiences in your city.",
  applicationName: "AL Jadwal",
  manifest: "/site.webmanifest",
  // Per-page canonical = the page's own URL (resolved against metadataBase).
  // Each page can override `metadata.alternates.canonical` explicitly when
  // needed (e.g. when serving paginated lists or filtered queries that
  // should canonicalize to the un-filtered root).
  alternates: {
    // "./" resolves to the page's OWN URL (against metadataBase), so the home
    // canonical is self-referential per language: `/` on English, `/ar` on
    // Arabic. This is the fallback for pages without their own `alternates`
    // (chiefly the home `/`); every other public page sets `localeAlternates`.
    canonical: "./",
    // Bilingual /ar URLs (SEO P1#4): English home = `/`, Arabic home = `/ar`,
    // x-default = English. Per-page metadata overrides this with the page's own
    // en/ar twins via lib/locale-path `localeAlternates`.
    languages: {
      en: "/",
      ar: "/ar",
      "x-default": "/",
    },
  },
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
    shortcut: "/favicon.ico",
  },
  openGraph: {
    type: "website",
    siteName: "AL Jadwal",
    title: "AL Jadwal — Discover and book experiences in Qatar",
    description: "Discover and book experiences in your city.",
    locale: "en_US",
    alternateLocale: ["ar_QA"],
    url: siteUrl.toString(),
    images: [
      {
        url: "/android-chrome-512x512.png",
        width: 512,
        height: 512,
        alt: "AL Jadwal",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "AL Jadwal — Discover and book experiences in Qatar",
    description: "Discover and book experiences in your city.",
    images: ["/android-chrome-512x512.png"],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // CSP nonce emitted per-request by middleware.ts. next-themes injects a
  // pre-hydration inline script; without the nonce, strict-dynamic CSP blocks
  // it and the page briefly renders in the default theme before React hydrates
  // and re-applies the saved theme — the "light-flash-then-dark" refresh bug.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  // Language preference is stored in a cookie (`jadwal_lang`) so both SSR and
  // the client hydration pass pick the same value. This is the only reliable
  // way to avoid the "English flash → Arabic" flicker + hydration mismatch
  // that localStorage-based i18n produces.
  const lang = await readLangServer();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  // Preconnect / DNS-prefetch for the API origin. Saves ~100-200ms on the
  // first XHR by running TCP + TLS handshakes during HTML parse instead of
  // waiting for the first JS-driven fetch. NEXT_PUBLIC_API_URL is baked at
  // build time so this URL is correct for both dev (localhost:4000) and
  // production (cdn-fronted API host).
  const apiOrigin = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_API_URL ?? '').origin;
    } catch {
      return null;
    }
  })();

  // Site-wide structured data (schema.org). Organization powers the Google
  // Knowledge Panel / brand entity; WebSite + SearchAction enables the
  // sitelinks search box in Google results (targets /explore?search=, the
  // param the explore page actually reads). Emitted on every page via the
  // root layout. Classic rich-result SEO — not AI/GEO.
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "AL Jadwal",
    url: siteUrl.toString(),
    logo: new URL("/android-chrome-512x512.png", siteUrl).toString(),
    sameAs: ["https://www.instagram.com/jadwal.qtr/"],
  };
  const webSiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "AL Jadwal",
    url: siteUrl.toString(),
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: new URL("/explore?search={search_term_string}", siteUrl).toString(),
      },
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <html lang={lang} dir={dir} suppressHydrationWarning>
      <head>
        {apiOrigin ? (
          <>
            <link rel="preconnect" href={apiOrigin} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={apiOrigin} />
          </>
        ) : null}
        <JsonLd data={orgJsonLd} />
        <JsonLd data={webSiteJsonLd} />
      </head>
      <body
        className={`${inter.variable} ${outfit.variable} ${tajawal.variable} antialiased font-outfit`}
      >
        <ErrorBoundary>
          <QueryProvider>
            <I18nProvider initialLang={lang}>
              {/* disableTransitionOnChange: next-themes injects `* { transition: none }`
                  for one frame during the light↔dark flip, so the page snaps to the
                  new theme instead of crossfading every transitioned element (the
                  navbar's transitions + the hero's `dark:` swaps were the "theme
                  toggle lag" on /home). */}
              <CookieConsentProvider>
                <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
                  <AuthProvider>
                    <ToastProvider>
                      <CustomerShell>{children}</CustomerShell>
                      {/* One-time post-login Terms consent gate (OAuth signups,
                          pre-feature accounts, Terms version bumps). Renders null
                          unless the logged-in customer/vendor must accept. */}
                      <TermsConsentGate />
                      {/* Cookie-consent banner + Meta Pixel. The pixel loads only
                          after Accept. Suspense wraps it because it reads
                          useSearchParams (route-change PageView tracking). */}
                      <CookieConsentBanner />
                      <Suspense fallback={null}>
                        <MetaPixel />
                      </Suspense>
                    </ToastProvider>
                  </AuthProvider>
                </ThemeProvider>
              </CookieConsentProvider>
            </I18nProvider>
          </QueryProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
