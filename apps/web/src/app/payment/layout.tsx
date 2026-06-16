/**
 * /payment — transactional, definitely no SEO surface.
 * `noindex, nofollow` so search engines never list payment-callback or
 * confirmation URLs (which can include order tokens / IDs in query
 * strings on some flows).
 */

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Payment — AL Jadwal',
  robots: { index: false, follow: false },
};

export default function PaymentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
