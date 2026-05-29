/**
 * /terms — server-rendered metadata. The terms page itself is a client
 * component (i18n + animations), so its SEO metadata lives in this sibling
 * server layout (same pattern as /about).
 */

import type { Metadata } from 'next';
import { cookies } from 'next/headers';

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const lang = cookieStore.get('jadwal_lang')?.value === 'ar' ? 'ar' : 'en';

  const title = lang === 'ar' ? 'الشروط والأحكام' : 'Terms & Conditions';
  const description =
    lang === 'ar'
      ? 'شروط استخدام منصة جدول لحجز الأنشطة والتجارب: الحسابات، الحجوزات، الإلغاء، مسؤوليات البائعين، والامتثال للقوانين القطرية.'
      : 'The terms for using Jadwal to book activities and experiences: accounts, bookings, cancellations, vendor responsibilities and Qatar legal compliance.';

  return {
    title,
    description,
    alternates: { canonical: '/terms' },
    openGraph: {
      title,
      description,
      type: 'website',
      siteName: 'Jadwal',
      locale: lang === 'ar' ? 'ar_QA' : 'en_US',
    },
    twitter: { card: 'summary', title, description },
  };
}

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
