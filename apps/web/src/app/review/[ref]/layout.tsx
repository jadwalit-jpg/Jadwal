/**
 * /review/<ref> — the review-ask landing page. Personal (one booking of one
 * customer), so `noindex, nofollow` like /bookings.
 */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Rate your experience — AL Jadwal',
  robots: { index: false, follow: false },
};

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
