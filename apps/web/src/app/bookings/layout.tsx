/**
 * /bookings (list + /[id] detail) — auth-gated, `noindex, nofollow`.
 * Same rationale as /profile/layout.tsx.
 */

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Bookings — Jadwal',
  robots: { index: false, follow: false },
};

export default function BookingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
