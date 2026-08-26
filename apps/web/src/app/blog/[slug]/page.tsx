/**
 * Tier-2 SEO guide pages (data-driven from lib/seo-guides.ts). Server-rendered →
 * full long-form content + Article/BreadcrumbList JSON-LD in the SSR HTML.
 * generateStaticParams + dynamicParams=false → only configured guides render;
 * unpublished guides render but are noindex (and excluded from the blog index +
 * sitemap). Each guide links DOWN to the bookable Phase-A landing pages.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import { JsonLd } from '@/components/json-ld';
import { ActivityCard } from '@/components/ui';
import { getGuide, tr } from '@/lib/seo-guides';
import { getLanding, landingCopy, type LandingLang } from '@/lib/seo-landings';
import { guidePicks } from '@/lib/seo-guide-picks';
import { readLangServer } from '@/lib/lang-cookie.server';
import { localePath, localeAlternates } from '@/lib/locale-path';

// Fully dynamic: reads the `jadwal_lang` cookie to render EN/AR server-side, so it
// must render per request. We avoid generateStaticParams + dynamicParams=false
// (that prerenders one frozen language at build and serves it to everyone); the
// slug allow-list is enforced at runtime via notFound() instead.
export const dynamic = 'force-dynamic';

function siteOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jadwal.qa').origin;
  } catch {
    return 'https://jadwal.qa';
  }
}

async function readLang(): Promise<LandingLang> {
  return readLangServer();
}


export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuide(slug);
  // Unknown slug → hard 404, set in generateMetadata (pre-stream) so the status sticks.
  if (!guide) notFound();
  const lang = await readLang();
  const title = tr(guide.title, lang);
  const description = tr(guide.description, lang);
  return {
    title,
    description,
    robots: { index: guide.published, follow: true },
    alternates: localeAlternates(`/blog/${guide.slug}`, lang),
    openGraph: {
      title,
      description,
      url: localePath(`/blog/${guide.slug}`, lang),
      type: 'article',
      siteName: 'AL Jadwal',
      locale: lang === 'ar' ? 'ar_QA' : 'en_US',
      publishedTime: guide.updated,
      modifiedTime: guide.updated,
      images: [{ url: '/images/login-bg.webp', width: 1920, height: 1080, alt: title }],
    },
    twitter: { card: 'summary_large_image', title, description, images: ['/images/login-bg.webp'] },
  };
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound(); // unknown slug → 404 (replaces the old dynamicParams=false gate)
  const lang = await readLang();
  const isAr = lang === 'ar';
  const origin = siteOrigin();

  const related = guide.relatedLandings
    .map(getLanding)
    .filter((l): l is NonNullable<typeof l> => !!l && l.launched);
  const picks = await guidePicks(related);

  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: tr(guide.title, lang),
    description: tr(guide.description, lang),
    inLanguage: lang === 'ar' ? 'ar-QA' : 'en-QA',
    datePublished: guide.updated,
    dateModified: guide.updated,
    mainEntityOfPage: `${origin}/blog/${guide.slug}`,
    author: { '@type': 'Organization', name: 'AL Jadwal', url: `${origin}/` },
    publisher: {
      '@type': 'Organization',
      name: 'AL Jadwal',
      logo: { '@type': 'ImageObject', url: `${origin}/android-chrome-512x512.png` },
    },
  };
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: isAr ? 'الدليل' : 'Guides', item: `${origin}/blog` },
      { '@type': 'ListItem', position: 3, name: tr(guide.title, lang), item: `${origin}/blog/${guide.slug}` },
    ],
  };
  // ItemList over the real picks. "Best X in Doha" queries are list-intent, and
  // this is what lets Google read the guide as a curated list of bookable
  // things rather than an undifferentiated blob of prose. Only emitted when
  // there ARE picks — schema that describes content the page does not actually
  // show is a structured-data violation, and a manual action risk.
  const itemListLd =
    picks.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: tr(guide.title, lang),
          itemListOrder: 'https://schema.org/ItemListUnordered',
          numberOfItems: picks.length,
          itemListElement: picks.map((p, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: `${origin}/activity/${p.slug}`,
            name: isAr && p.titleAr ? p.titleAr : p.titleEn,
          })),
        }
      : null;

  return (
    <>
      {guide.published && (
        <JsonLd data={itemListLd ? [articleLd, breadcrumbLd, itemListLd] : [articleLd, breadcrumbLd]} />
      )}
      <Navbar variant="solid" />
      <main className="min-h-[60vh] bg-jadwal-bg">
        <article className="max-w-3xl mx-auto px-4 sm:px-6 pt-24 pb-12 md:pt-28 md:pb-16">
          <nav className="mb-6 text-sm text-jadwal-text-muted">
            <Link href={localePath('/blog', lang)} className="hover:text-jadwal-accent">
              {isAr ? 'الدليل' : 'Guides'}
            </Link>
          </nav>
          <h1 className="text-3xl md:text-4xl font-bold text-jadwal-text tracking-tight text-start">
            {tr(guide.title, lang)}
          </h1>
          <p className="mt-4 text-lg text-jadwal-text-muted leading-relaxed text-start">
            {tr(guide.intro, lang)}
          </p>

          {guide.sections.map((s, i) => (
            <section key={i} className="mt-8">
              <h2 className="text-xl md:text-2xl font-bold text-jadwal-text text-start">
                {tr(s.heading, lang)}
              </h2>
              {s.body.map((p, j) => (
                <p key={j} className="mt-3 text-jadwal-text-muted leading-relaxed text-start">
                  {tr(p, lang)}
                </p>
              ))}
            </section>
          ))}

          {/* Real, bookable inventory — the guide's payoff. Deliberately NOT
              preloaded: unlike the landing pages (where card 0 IS the LCP
              element), this grid sits below ~1,000px of long-form prose, and
              the measured LCP on these pages is a paragraph at ~858ms. A
              preload here would race the text that actually paints. */}
          {picks.length > 0 && (
            <section className="mt-12">
              <h2 className="text-xl md:text-2xl font-bold text-jadwal-text mb-4 text-start">
                {isAr ? 'احجز هذه التجارب' : 'Book these experiences'}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5">
                {picks.map((p) => (
                  <ActivityCard key={p.id} activity={p} size="fill" />
                ))}
              </div>
              <Link
                href={localePath('/explore', lang)}
                className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-jadwal-accent hover:underline"
              >
                {isAr ? 'تصفّح جميع الأنشطة' : 'Browse all activities'}
                <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            </section>
          )}

          {related.length > 0 && (
            <section className="mt-12 rounded-2xl border border-jadwal-border-subtle bg-jadwal-surface p-6">
              <h2 className="text-lg font-bold text-jadwal-text mb-4 text-start">
                {isAr ? 'استكشف حسب الفئة' : 'Explore by category'}
              </h2>
              <div className="flex flex-wrap gap-3">
                {related.map((r) => (
                  <Link
                    key={r.slug}
                    href={localePath(`/${r.slug}`, lang)}
                    className="inline-flex items-center gap-2 rounded-full bg-jadwal-accent px-4 py-2 text-sm font-semibold text-white"
                  >
                    {landingCopy(r, lang).h1}
                    <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </section>
          )}
        </article>
      </main>
      <Footer />
    </>
  );
}
