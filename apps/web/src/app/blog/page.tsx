/**
 * Blog / guides index — lists published Tier-2 SEO guides. Server-rendered.
 */

import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import { publishedGuides, tr } from '@/lib/seo-guides';
import type { LandingLang } from '@/lib/seo-landings';

export const revalidate = 3600;

async function readLang(): Promise<LandingLang> {
  const c = await cookies();
  return c.get('jadwal_lang')?.value === 'ar' ? 'ar' : 'en';
}

export async function generateMetadata(): Promise<Metadata> {
  const lang = await readLang();
  const title = lang === 'ar' ? 'دليل قطر — أفكار ونصائح للأنشطة' : 'Qatar Guides — Things to Do, Tips & Itineraries';
  const description =
    lang === 'ar'
      ? 'أدلة قطر: أفضل الأنشطة، خطط الرحلات، وأفضل الأوقات للزيارة — مع روابط مباشرة للحجز عبر AL Jadwal.'
      : 'Qatar travel guides: the best things to do, itineraries and seasonal tips — with direct links to book on AL Jadwal.';
  return {
    title,
    description,
    alternates: { canonical: '/blog' },
    openGraph: {
      title,
      description,
      url: '/blog',
      type: 'website',
      siteName: 'AL Jadwal',
      locale: lang === 'ar' ? 'ar_QA' : 'en_US',
      images: [{ url: '/images/login-bg.webp', width: 1200, height: 630, alt: title }],
    },
    twitter: { card: 'summary_large_image', title, description, images: ['/images/login-bg.webp'] },
  };
}

export default async function BlogIndexPage() {
  const lang = await readLang();
  const isAr = lang === 'ar';
  const guides = publishedGuides();

  return (
    <>
      <Navbar variant="solid" />
      <main className="min-h-[60vh] bg-jadwal-bg">
        <section className="bg-jadwal-surface border-b border-jadwal-border-subtle">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 md:py-16">
            <h1 className="text-3xl md:text-4xl font-bold text-jadwal-text tracking-tight text-start">
              {isAr ? 'دليل قطر' : 'Qatar Guides'}
            </h1>
            <p className="mt-3 max-w-2xl text-jadwal-text-muted leading-relaxed text-start">
              {isAr
                ? 'أفكار ونصائح وخطط رحلات لمساعدتك على تخطيط وقتك في قطر — ثم احجز التجربة مباشرة.'
                : 'Ideas, tips and itineraries to help you plan your time in Qatar — then book the experience directly.'}
            </p>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-4 sm:px-6 py-10 md:py-14">
          {guides.length === 0 ? (
            <p className="text-jadwal-text-muted">{isAr ? 'لا توجد أدلة بعد.' : 'No guides yet.'}</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {guides.map((g) => (
                <li key={g.slug}>
                  <Link
                    href={`/blog/${g.slug}`}
                    className="group block h-full rounded-2xl border border-jadwal-border-subtle bg-jadwal-surface p-6 hover:border-jadwal-accent transition-colors"
                  >
                    <h2 className="text-lg font-bold text-jadwal-text text-start">{tr(g.title, lang)}</h2>
                    <p className="mt-2 text-sm text-jadwal-text-muted leading-relaxed text-start line-clamp-3">
                      {tr(g.description, lang)}
                    </p>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-jadwal-accent">
                      {isAr ? 'اقرأ الدليل' : 'Read guide'}
                      <ArrowRight className="h-4 w-4 rtl:-scale-x-100 group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
