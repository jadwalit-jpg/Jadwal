/**
 * /profile (and nested routes) — explicitly `noindex, nofollow`. The
 * page is auth-gated client-side, but search engines can still discover
 * the URL and try to index it. The robots meta tag tells them not to.
 * Belt-and-braces alongside the auth wall.
 */

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Profile — AL Jadwal',
  robots: { index: false, follow: false },
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
