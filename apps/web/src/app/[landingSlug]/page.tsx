/**
 * Keyword SEO landing pages (data-driven — one server-rendered route renders the
 * whole `lib/seo-landings.ts` registry). Examples: /desert-safari-qatar,
 * /yacht-rental-qatar, /caravan-rental-qatar.
 *
 * Server Component → the H1, intro copy and the matching-activity grid are all in
 * the SSR HTML (crawlers read real content immediately). `generateStaticParams` +
 * `dynamicParams = false` mean ONLY configured slugs render (SSG) and every other
 * unknown single-segment path 404s; static routes (/about, /explore, …) still take
 * priority, so there is no shadowing. Dormant (unlaunched) pages render but are
 * `noindex` and excluded from the sitemap.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { readLangServer } from '@/lib/lang-cookie.server';
import { localePath, localeAlternates } from '@/lib/locale-path';
import { ArrowRight } from 'lucide-react';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import { ActivityCard, type ActivityCardActivity } from '@/components/ui';
import { JsonLd } from '@/components/json-ld';
import { fetchActivities } from '@/lib/seo-fetch';
import { getLanding, landingCopy, type LandingLang } from '@/lib/seo-landings';

// Fully dynamic: the page reads the `jadwal_lang` cookie to render EN/AR
// server-side, so it MUST render per request. We deliberately do NOT use
// generateStaticParams + dynamicParams=false — that prerenders each slug ONCE at
// build (empty cookie → English) and serves that frozen EN HTML to every visitor
// incl. Arabic users (and lets Cloudflare edge-cache one language). The slug
// allow-list is enforced at runtime via notFound() instead. The activity fetch
// keeps its own `next: { revalidate: 3600 }`, so the data is still cached hourly.
export const dynamic = 'force-dynamic';

const GRID_LIMIT = 12;

function siteOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jadwal.qa').origin;
  } catch {
    return 'https://jadwal.qa';
  }
}

async function readLang(): Promise<LandingLang> {
  // URL-driven on /ar (x-lang header), cookie fallback otherwise — same source
  // of truth as every other public page so /ar/<slug> renders Arabic copy.
  return readLangServer();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ landingSlug: string }>;
}): Promise<Metadata> {
  const { landingSlug } = await params;
  const landing = getLanding(landingSlug);
  // Unknown slug → hard 404. Called in generateMetadata (runs BEFORE the page
  // streams) so the 404 status sticks; calling notFound() only in the streamed
  // page body yields a soft-404 (200 + not-found UI).
  if (!landing) notFound();
  const lang = await readLang();
  const copy = landingCopy(landing, lang);
  return {
    title: copy.metaTitle,
    description: copy.metaDescription,
    // Index + sitemap only the launched (real-inventory) pages; dormant ones are noindex.
    robots: { index: landing.launched, follow: true },
    alternates: localeAlternates(`/${landing.slug}`, lang),
    openGraph: {
      title: copy.metaTitle,
      description: copy.metaDescription,
      url: localePath(`/${landing.slug}`, lang),
      type: 'website',
      siteName: 'AL Jadwal',
      locale: lang === 'ar' ? 'ar_QA' : 'en_US',
      alternateLocale: lang === 'ar' ? ['en_US'] : ['ar_QA'],
      images: [{ url: '/images/login-bg.webp', width: 1920, height: 1080, alt: copy.metaTitle }],
    },
    twitter: { card: 'summary_large_image', title: copy.metaTitle, description: copy.metaDescription, images: ['/images/login-bg.webp'] },
  };
}

/** Map a fetched catalog activity to the ActivityCard shape (coerce price to number). */
function toCard(a: Awaited<ReturnType<typeof fetchActivities>>['data'][number]): ActivityCardActivity {
  return {
    id: a.id,
    slug: a.slug,
    titleEn: a.titleEn,
    titleAr: a.titleAr,
    pricePerPerson: Number.isFinite(Number(a.pricePerPerson)) ? Number(a.pricePerPerson) : 0,
    country: a.country?.currencyCode ? { currencyCode: a.country.currencyCode } : null,
    city: a.city ?? null,
    vendor: a.vendor ?? null,
    coverImage: a.coverImage,
    avgRating: a.avgRating ?? null,
    reviewCount: a.reviewCount ?? 0,
    bookingType: a.bookingType,
  };
}

export default async function LandingPage({
  params,
}: {
  params: Promise<{ landingSlug: string }>;
}) {
  const { landingSlug } = await params;
  const landing = getLanding(landingSlug);
  if (!landing) notFound(); // unknown slug → 404 (replaces the old dynamicParams=false gate)
  const lang = await readLang();
  const isAr = lang === 'ar';
  const copy = landingCopy(landing, lang);

  const { data } = await fetchActivities({ ...landing.filter, limit: GRID_LIMIT });
  const cards = data.map(toCard);

  const related = landing.related
    .map(getLanding)
    .filter((l): l is NonNullable<typeof l> => !!l && l.launched && l.slug !== landing.slug);

  const origin = siteOrigin();
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: copy.h1, item: `${origin}/${landing.slug}` },
    ],
  };

  return (
    <>
      {landing.launched && <JsonLd data={breadcrumb} />}
      <Navbar variant="solid" />
      <main className="min-h-[60vh] bg-jadwal-bg">
        {/* Hero */}
        <section className="bg-jadwal-surface border-b border-jadwal-border-subtle">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-24 pb-12 md:pt-28 md:pb-16">
            <h1 className="text-3xl md:text-4xl font-bold text-jadwal-text tracking-tight text-start">
              {copy.h1}
            </h1>
            <p className="mt-3 max-w-3xl text-jadwal-text-muted leading-relaxed text-start">
              {copy.intro}
            </p>
          </div>
        </section>

        {/* Activity grid */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 py-10 md:py-14">
          {cards.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
              {cards.map((c) => (
                <ActivityCard key={c.id} activity={c} size="fill" />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-jadwal-border-subtle bg-jadwal-surface p-8 text-center">
              <p className="text-jadwal-text-muted">
                {isAr
                  ? 'لا توجد نتائج متاحة حالياً. تصفّح جميع الأنشطة المتاحة في قطر.'
                  : 'No listings available right now. Browse all activities available in Qatar.'}
              </p>
              <Link
                href={localePath('/explore', lang)}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-jadwal-accent px-5 py-2.5 text-sm font-semibold text-white"
              >
                {isAr ? 'تصفّح الكل' : 'Browse all activities'}
                <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            </div>
          )}
        </section>

        {/* Internal links to related landing pages (launched only) */}
        {related.length > 0 && (
          <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-14">
            <h2 className="text-lg font-bold text-jadwal-text mb-4 text-start">
              {isAr ? 'استكشف المزيد' : 'Explore more'}
            </h2>
            <div className="flex flex-wrap gap-3">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  href={localePath(`/${r.slug}`, lang)}
                  className="inline-flex items-center gap-2 rounded-full border border-jadwal-border-subtle bg-jadwal-surface px-4 py-2 text-sm font-medium text-jadwal-text hover:border-jadwal-accent transition-colors"
                >
                  {landingCopy(r, lang).h1}
                  <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100 opacity-60" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}
