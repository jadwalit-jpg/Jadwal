/**
 * SEO layout for the bespoke "Red Sea Escape" landing page (/redsea).
 *
 * Two server-side jobs (same pattern as activity/[slug]/layout.tsx):
 *   1. generateMetadata → title/description + Open Graph + Twitter Card so
 *      WhatsApp / Telegram / Twitter render a rich preview when the link is
 *      shared, plus self-referential canonical + hreflang via localeAlternates.
 *   2. The layout body → schema.org JSON-LD (TouristTrip) describing the
 *      3-night Red Sea escape from Doha, emitted via the audited <JsonLd>.
 */

import type { Metadata } from 'next';
import { JsonLd } from '@/components/json-ld';
import { readLangServer } from '@/lib/lang-cookie.server';
import { localeAlternates, localePath } from '@/lib/locale-path';

const TITLE = 'The Red Sea Escape from Doha';
const DESCRIPTION =
  'Three nights at InterContinental The Red Sea, direct from Doha. Curated end to end by Al Jadwal. Tell us what you love — we design the rest.';

export async function generateMetadata(): Promise<Metadata> {
  const lang = await readLangServer();
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: localeAlternates('/redsea', lang),
    robots: { index: true, follow: true },
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      url: localePath('/redsea', lang),
      type: 'website',
      siteName: 'AL Jadwal',
      locale: lang === 'ar' ? 'ar_QA' : 'en_US',
      images: [{ url: '/redsea-og.webp', width: 1200, height: 630, alt: TITLE }],
    },
    twitter: {
      card: 'summary_large_image',
      title: TITLE,
      description: DESCRIPTION,
      images: ['/redsea-og.webp'],
    },
  };
}

export default function RedSeaLayout({ children }: { children: React.ReactNode }) {
  // TouristTrip structured data for the 3-night Red Sea escape from Doha.
  const tripJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TouristTrip',
    name: 'The Red Sea Escape',
    description: DESCRIPTION,
    image: 'https://jadwal.qa/redsea-og.webp',
    touristType: 'Couples · Luxury travellers',
    provider: {
      '@type': 'TravelAgency',
      name: 'AL Jadwal',
      url: 'https://jadwal.qa',
    },
    itinerary: {
      '@type': 'ItemList',
      numberOfItems: 3,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Direct flight from Doha to The Red Sea' },
        { '@type': 'ListItem', position: 2, name: 'Three nights at InterContinental The Red Sea, Shura Island' },
        { '@type': 'ListItem', position: 3, name: 'Curated experiences — reef, water, desert & stars' },
      ],
    },
    offers: {
      '@type': 'Offer',
      priceCurrency: 'QAR',
      price: '12060',
      description: 'Per couple · three nights · breakfast, transfers & concierge included',
      availability: 'https://schema.org/InStock',
      seller: { '@type': 'TravelAgency', name: 'AL Jadwal' },
    },
  };

  return (
    <>
      <JsonLd data={tripJsonLd} />
      {children}
    </>
  );
}
