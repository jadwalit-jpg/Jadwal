/**
 * /explore — server-rendered metadata. The page itself is a client
 * component (filters, search params, react-query). This RSC layout sits
 * above it and emits proper title / description / OG / Twitter tags so
 * Google ranks the page distinctly from the home, and WhatsApp/Twitter/
 * Slack render rich previews instead of the bland default ("AL Jadwal —
 * Discover and book experiences in your city.") inherited from the root.
 */

import type { Metadata } from 'next';
import { readLangServer } from '@/lib/lang-cookie.server';
import { localeAlternates } from '@/lib/locale-path';

export async function generateMetadata(): Promise<Metadata> {
  const lang = await readLangServer();

  // NO brand suffix here: the root layout applies `template: '%s · AL Jadwal'`,
  // so adding it again rendered "Explore Activities — AL Jadwal · AL Jadwal"
  // and burned ~11 characters of the 60-char SERP title on a repeat.
  // Item 11 (Nov 2026). Rendered as "<title> · AL Jadwal" via the root template.
  const title =
    lang === 'ar'
      ? 'الأنشطة في قطر: يخوت، منتجعات، سفاري الصحراء ورياضات مائية'
      : 'Activities in Qatar: Yachts, Resorts, Desert Safari & Water Sports';
  // og:title has no template applied, so it carries the brand itself.
  const ogTitle = lang === 'ar' ? 'استكشف الأنشطة — الجدول' : 'Explore Activities — AL Jadwal';
  // Counts and prices checked against the live catalog (Nov 2026): 46 active
  // listings, cheapest = Kayak Ride QAR 100. Keep these true when inventory changes.
  const description =
    lang === 'ar'
      ? 'تصفّح أكثر من 45 نشاطاً في قطر: تأجير اليخوت، المنتجعات والشاليهات الخاصة، سفاري الصحراء، الكرفانات والرياضات المائية. الأسعار تبدأ من 100 ريال. احجز أونلاين مع الجدول.'
      : 'Browse 45+ activities in Qatar: yacht rental, private resorts and chalets, desert safari, caravans and water sports. Prices from QAR 100. Book online with AL Jadwal.';

  return {
    title,
    description,
    // Self-canonical per language (en → /explore, ar → /ar/explore) + hreflang,
    // so each language version is indexed on its own URL and the ?country=…
    // filter permutations still consolidate onto the (per-language) base.
    alternates: localeAlternates('/explore', lang),
    openGraph: {
      title: ogTitle,
      description,
      type: 'website',
      siteName: 'AL Jadwal',
      locale: lang === 'ar' ? 'ar_QA' : 'en_US',
      images: [{ url: '/images/login-bg.webp', width: 1920, height: 1080, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description,
      images: ['/images/login-bg.webp'],
    },
  };
}

export default function ExploreLayout({ children }: { children: React.ReactNode }) {
  return children;
}
