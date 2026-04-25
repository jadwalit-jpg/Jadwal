import { Metadata } from 'next';
import HomeClient from './home-client';

export const metadata: Metadata = {
  title: 'Jadwal — Discover & Book Experiences in Qatar',
  description:
    'Find and book the best activities, tours, and experiences across Qatar. 50+ verified partners, instant confirmation, and 24/7 support.',
  keywords: [
    'Qatar activities',
    'book experiences Qatar',
    'tours Qatar',
    'things to do in Qatar',
    'Doha activities',
    'Jadwal',
  ],
  openGraph: {
    title: 'Jadwal — Discover & Book Experiences in Qatar',
    description:
      'Discover activities, tours, and experiences across Qatar. Instant confirmation. 50+ verified partners.',
    type: 'website',
    siteName: 'Jadwal',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Jadwal — Discover & Book Experiences in Qatar',
    description:
      'Discover activities, tours, and experiences across Qatar. Instant confirmation. 50+ verified partners.',
  },
};

export default function Page() {
  return <HomeClient />;
}
