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

  const title =
    lang === 'ar' ? 'استكشف الأنشطة — الجدول' : 'Explore Activities — AL Jadwal';
  const description =
    lang === 'ar'
      ? 'تصفح أكثر من 50 تجربة موثوقة عبر قطر — رحلات السفاري، الجولات الثقافية، الرياضات المائية، تجارب الطعام والمزيد.'
      : 'Browse 50+ vetted experiences across Qatar — Desert Safari, Cultural Tours, Water Sports, Dining and more.';

  return {
    title,
    description,
    // Self-canonical per language (en → /explore, ar → /ar/explore) + hreflang,
    // so each language version is indexed on its own URL and the ?country=…
    // filter permutations still consolidate onto the (per-language) base.
    alternates: localeAlternates('/explore', lang),
    openGraph: {
      title,
      description,
      type: 'website',
      siteName: 'AL Jadwal',
      locale: lang === 'ar' ? 'ar_QA' : 'en_US',
      images: [{ url: '/images/login-bg.webp', width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/images/login-bg.webp'],
    },
  };
}

export default function ExploreLayout({ children }: { children: React.ReactNode }) {
  return children;
}
