/**
 * /about — server-rendered metadata. The about page itself is a client
 * component that fetches the platform's editable About text from
 * /catalog/platform-info. We deliberately keep that copy out of the OG
 * description (it's optional admin-edited content that may not exist
 * yet) and use a stable launch-friendly description instead.
 */

import type { Metadata } from 'next';
import { readLangServer } from '@/lib/lang-cookie.server';
import { localeAlternates } from '@/lib/locale-path';

export async function generateMetadata(): Promise<Metadata> {
  const lang = await readLangServer();

  const title = lang === 'ar' ? 'عن الجدول' : 'About AL Jadwal';
  const description =
    lang === 'ar'
      ? 'منصة الجدول هي وجهتك لاكتشاف وحجز أفضل التجارب والأنشطة في قطر ودول الخليج، بشركاء موثوقين ودعم على مدار الساعة.'
      : 'AL Jadwal is the GCC marketplace for discovering and booking handpicked experiences and activities — vetted partners, instant confirmation, 24/7 support.';

  return {
    title,
    description,
    alternates: localeAlternates('/about', lang),
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

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
