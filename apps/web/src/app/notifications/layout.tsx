/**
 * /notifications — auth-gated customer notifications list. `noindex, nofollow`
 * — same rationale as `/likes/layout.tsx` and `/profile/layout.tsx`: a
 * per-user listing has no public/search value.
 */

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Notifications — AL Jadwal',
  robots: { index: false, follow: false },
};

export default function NotificationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
