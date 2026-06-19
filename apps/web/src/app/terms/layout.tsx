/**
 * /terms — server-rendered metadata. The terms page itself is a client
 * component (i18n + animations), so its SEO metadata lives in this sibling
 * server layout (same pattern as /about).
 */

import type { Metadata } from 'next';
import { readLangServer } from '@/lib/lang-cookie.server';
import { localeAlternates } from '@/lib/locale-path';

export async function generateMetadata(): Promise<Metadata> {
  const lang = await readLangServer();

  const title = lang === 'ar' ? 'الشروط والأحكام' : 'Terms & Conditions';
  const description =
    lang === 'ar'
      ? 'شروط استخدام منصة جدول لحجز الأنشطة والتجارب: الحسابات، الحجوزات، الإلغاء، مسؤوليات البائعين، والامتثال للقوانين القطرية.'
      : 'The terms for using AL Jadwal to book activities and experiences: accounts, bookings, cancellations, vendor responsibilities and Qatar legal compliance.';

  return {
    title,
    description,
    alternates: localeAlternates('/terms', lang),
    openGraph: {
      title,
      description,
      type: 'website',
      siteName: 'AL Jadwal',
      locale: lang === 'ar' ? 'ar_QA' : 'en_US',
    },
    twitter: { card: 'summary', title, description },
  };
}

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
