/**
 * "The Red Sea Escape — Al Jadwal" — a bespoke luxury landing page.
 *
 * Server component: loads the page-scoped display fonts via next/font (self-
 * hosted, CSP-safe) and exposes them as CSS variables on the page wrapper, then
 * renders the animated/interactive body from the client island. SEO metadata +
 * JSON-LD live in the sibling layout.tsx.
 *
 * Standalone page — intentionally no site Navbar/Footer; it has its own header
 * and footer. The root layout still wraps it.
 */

import { Playfair_Display, Noto_Naskh_Arabic } from 'next/font/google';
import RedSeaClient from './_redsea-client';

const playfair = Playfair_Display({
  variable: '--font-redsea-serif',
  subsets: ['latin'],
  weight: ['500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
});

const naskh = Noto_Naskh_Arabic({
  variable: '--font-redsea-ar',
  subsets: ['arabic'],
  weight: ['400', '500'],
  display: 'swap',
});

export default function RedSeaPage() {
  return (
    <div
      className={`${playfair.variable} ${naskh.variable} min-h-screen scroll-smooth bg-[#FAF7F2] text-[#0F1419] antialiased`}
    >
      <RedSeaClient />
    </div>
  );
}
