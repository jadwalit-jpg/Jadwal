import type { Metadata } from "next";
import { Inter, Tajawal, Outfit } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { AuthProvider } from "@/context/auth-context";
import { I18nProvider } from "@/context/i18n-provider";
import { ThemeProvider } from "next-themes";
import { QueryProvider } from "@/lib/query-provider";
import { ToastProvider } from "@/components/toast";
// CustomerShell conditionally wraps children with GeoProvider + LazyPrompts
// based on pathname. Staff (admin / vendor) and auth routes skip both —
// they don't need country detection or "verify your phone" prompts.
// Verified safe: 0 useGeo calls in admin / vendor source.
import { CustomerShell } from "@/components/customer-shell";
import { readLangCookieServer } from "@/lib/lang-cookie.server";

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
const tajawal = Tajawal({
  variable: "--font-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "700", "800"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "Jadwal",
  description: "Discover and book experiences in your city.",
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
  const lang = await readLangCookieServer();
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

  return (
    <html lang={lang} dir={dir} suppressHydrationWarning>
      <head>
        {apiOrigin ? (
          <>
            <link rel="preconnect" href={apiOrigin} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={apiOrigin} />
          </>
        ) : null}
      </head>
      <body
        className={`${inter.variable} ${outfit.variable} ${tajawal.variable} antialiased font-outfit`}
      >
        <QueryProvider>
          <I18nProvider initialLang={lang}>
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem nonce={nonce}>
              <AuthProvider>
                <ToastProvider>
                  <CustomerShell>{children}</CustomerShell>
                </ToastProvider>
              </AuthProvider>
            </ThemeProvider>
          </I18nProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
