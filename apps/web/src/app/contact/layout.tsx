/**
 * /contact — server-rendered metadata. The contact page itself is a client
 * component (i18n + form), so its SEO metadata lives in this sibling server
 * layout (same pattern as /about).
 */

import type { Metadata } from 'next';
import { cookies } from 'next/headers';

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const lang = cookieStore.get('jadwal_lang')?.value === 'ar' ? 'ar' : 'en';

  const title = lang === 'ar' ? 'تواصل معنا' : 'Contact Us';
  const description =
    lang === 'ar'
      ? 'تواصل مع فريق جدول للأسئلة حول الحجوزات، أو الانضمام كبائع، أو الدعم — نرد عليك في أقرب وقت.'
      : 'Get in touch with the Jadwal team for booking questions, becoming a vendor, or support — we’ll get back to you shortly.';

  return {
    title,
    description,
    alternates: { canonical: '/contact' },
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

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
