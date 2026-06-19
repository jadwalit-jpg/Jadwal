/**
 * /privacy — server-rendered metadata. The privacy page itself is a client
 * component (i18n + animations), so its SEO metadata lives in this sibling
 * server layout (same pattern as /about).
 */

import type { Metadata } from 'next';
import { readLangServer } from '@/lib/lang-cookie.server';
import { localeAlternates } from '@/lib/locale-path';

export async function generateMetadata(): Promise<Metadata> {
  const lang = await readLangServer();

  const title = lang === 'ar' ? 'سياسة الخصوصية' : 'Privacy Policy';
  const description =
    lang === 'ar'
      ? 'كيف تجمع منصة جدول بياناتك وتستخدمها وتحميها، وحقوقك بموجب قانون حماية البيانات الشخصية القطري (PDPPL).'
      : 'How AL Jadwal collects, uses and protects your data, and your rights under Qatar’s Personal Data Privacy Protection Law (PDPPL).';

  return {
    title,
    description,
    alternates: localeAlternates('/privacy', lang),
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

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
