/**
 * /likes (wishlist) — auth-gated, `noindex, nofollow`.
 * Same rationale as /profile/layout.tsx.
 */

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Liked Activities — AL Jadwal',
  robots: { index: false, follow: false },
};

export default function LikesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
