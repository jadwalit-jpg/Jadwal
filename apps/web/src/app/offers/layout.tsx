/**
 * /offers — server-rendered metadata. See `explore/layout.tsx` for the
 * pattern rationale. Coupon claim itself is auth-gated server-side
 * (JwtAuthGuard + CUSTOMER role check on POST /offers/:id/claim) so
 * indexing this page doesn't expose any privileged action.
 */

import type { Metadata } from 'next';
import { readLangServer } from '@/lib/lang-cookie.server';
import { localeAlternates } from '@/lib/locale-path';

export async function generateMetadata(): Promise<Metadata> {
  const lang = await readLangServer();

  // NO brand suffix — the root title template appends it. Same note as
  // explore/layout.tsx.
  const title = lang === 'ar' ? 'العروض والكوبونات' : 'Offers & Coupons';
  const ogTitle = lang === 'ar' ? 'العروض والكوبونات — الجدول' : 'Offers & Coupons — AL Jadwal';
  const description =
    lang === 'ar'
      ? 'وفّر على تجاربك المفضلة في قطر مع كوبونات الخصم والعروض الحصرية من جدول.'
      : 'Save on Qatar experiences with exclusive AL Jadwal coupons and limited-time offers — desert safaris, dhow cruises, water sports and more, discounted.';

  return {
    title,
    description,
    alternates: localeAlternates('/offers', lang),
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

export default function OffersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
