/**
 * /privacy — server-rendered metadata. The privacy page itself is a client
 * component (i18n + animations), so its SEO metadata lives in this sibling
 * server layout (same pattern as /about).
 */

import type { Metadata } from 'next';
import { cookies } from 'next/headers';

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const lang = cookieStore.get('jadwal_lang')?.value === 'ar' ? 'ar' : 'en';

  const title = lang === 'ar' ? 'سياسة الخصوصية' : 'Privacy Policy';
  const description =
    lang === 'ar'
      ? 'كيف تجمع منصة جدول بياناتك وتستخدمها وتحميها، وحقوقك بموجب قانون حماية البيانات الشخصية القطري (PDPPL).'
      : 'How Jadwal collects, uses and protects your data, and your rights under Qatar’s Personal Data Privacy Protection Law (PDPPL).';

  return {
    title,
    description,
    alternates: { canonical: '/privacy' },
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

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
