/**
 * /offers — server-rendered metadata. See `explore/layout.tsx` for the
 * pattern rationale. Coupon claim itself is auth-gated server-side
 * (JwtAuthGuard + CUSTOMER role check on POST /offers/:id/claim) so
 * indexing this page doesn't expose any privileged action.
 */

import type { Metadata } from 'next';
import { cookies } from 'next/headers';

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const lang = cookieStore.get('jadwal_lang')?.value === 'ar' ? 'ar' : 'en';

  const title =
    lang === 'ar' ? 'العروض والكوبونات — جدول' : 'Offers & Coupons — Jadwal';
  const description =
    lang === 'ar'
      ? 'وفّر على تجاربك المفضلة في قطر مع كوبونات الخصم والعروض الحصرية من جدول.'
      : 'Save on your favourite experiences in Qatar with exclusive Jadwal vouchers and discount coupons.';

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      siteName: 'Jadwal',
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

export default function OffersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
