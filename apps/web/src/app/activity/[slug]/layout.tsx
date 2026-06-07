/**
 * Per-activity SEO layout. Two server-side jobs:
 *   1. generateMetadata → Open Graph + Twitter Card tags so WhatsApp /
 *      Telegram / iMessage / Slack / Twitter render a rich preview when an
 *      activity link is shared.
 *   2. The layout body → schema.org JSON-LD (Product + Offer +
 *      AggregateRating + BreadcrumbList) so Google can show price, star
 *      rating and breadcrumb rich results. Classic rich-result SEO.
 *
 * Both read the same public /catalog/activities/:slug endpoint (which 404s
 * non-ACTIVE listings / vendors, so neither previews nor schema can leak a
 * pending/rejected activity). Next.js request-memoises identical fetches, so
 * generateMetadata + the layout body share ONE network call per request.
 *
 * Security / robustness:
 *   - 3s AbortSignal timeout; any error falls back to brand metadata and
 *     simply omits JSON-LD (page still renders).
 *   - Description truncated to 160 chars and stripped of angle brackets.
 *   - Image URL normalised to an absolute allowlisted origin.
 *   - JSON-LD is emitted via the audited <JsonLd> component (server-built
 *     object, JSON.stringify'd, `<` escaped — never raw user HTML).
 */

import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { JsonLd } from '@/components/json-ld';

const META_FETCH_TIMEOUT_MS = 3000;
const DESCRIPTION_MAX = 160;

interface PublicActivity {
  slug?: string;
  titleEn?: string;
  titleAr?: string;
  descriptionEn?: string | null;
  descriptionAr?: string | null;
  coverImage?: string | null;
  pricePerPerson?: number | string | null;
  avgRating?: number | null;
  reviewCount?: number | null;
  category?: { nameEn?: string | null; nameAr?: string | null; slug?: string | null } | null;
  country?: { nameEn?: string | null; currencyCode?: string | null } | null;
  vendor?: { businessNameEn?: string | null; businessNameAr?: string | null } | null;
}

/** Strip stray HTML brackets and clamp to a social-card-friendly length. */
function safeDescription(raw: string | null | undefined): string {
  if (!raw) return '';
  const stripped = raw.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return stripped.length > DESCRIPTION_MAX
    ? stripped.slice(0, DESCRIPTION_MAX - 1) + '…'
    : stripped;
}

// Trusted origins for OG + schema images. Mirrors next.config `images.remotePatterns`
// (the CDN + S3 upload buckets) PLUS any configured origins. This is the fix for a
// prod bug where the image was silently dropped: cover images are served from
// https://cdn.jadwal.qa/… but the old allowlist was derived solely from
// NEXT_PUBLIC_API_URL, which is the RELATIVE "/api" in prod (no origin) — so every
// image failed the check. Defense-in-depth is preserved: an off-domain / untrusted
// coverImage is still rejected from share previews + structured data.
const TRUSTED_IMAGE_HOSTS = [
  'cdn.jadwal.qa',
  'jadwal-assets.s3.amazonaws.com',
  'jadwal-assets.s3.me-south-1.amazonaws.com',
] as const;

function trustedImageOrigins(): Set<string> {
  const allowed = new Set<string>();
  for (const host of TRUSTED_IMAGE_HOSTS) allowed.add(`https://${host}`);
  for (const base of [
    process.env.NEXT_PUBLIC_CDN_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_API_URL,
    process.env.INTERNAL_API_URL,
  ]) {
    if (!base) continue;
    try {
      allowed.add(new URL(base).origin);
    } catch {
      /* relative ("/api") or invalid → contributes no origin; skip */
    }
  }
  return allowed;
}

/**
 * Build an absolute, ALLOWLISTED URL for the cover image, dropping it entirely
 * if it points to an untrusted origin (defense-in-depth on share previews +
 * schema images). Prod cover images are absolute `https://cdn.jadwal.qa/…` URLs;
 * dev may serve a relative `/uploads/…` path from the API origin.
 */
function absoluteImageUrl(coverImage: string | null | undefined): string | null {
  if (!coverImage) return null;
  const allowed = trustedImageOrigins();
  if (allowed.size === 0) return null;

  let absolute: string;
  if (/^https?:\/\//i.test(coverImage)) {
    absolute = coverImage;
  } else {
    // Relative path (dev /uploads) → resolve against the API origin if it has one.
    let apiOrigin: string | null = null;
    try {
      apiOrigin = process.env.NEXT_PUBLIC_API_URL ? new URL(process.env.NEXT_PUBLIC_API_URL).origin : null;
    } catch {
      apiOrigin = null;
    }
    if (!apiOrigin) return null;
    absolute = coverImage.startsWith('/') ? `${apiOrigin}${coverImage}` : `${apiOrigin}/${coverImage}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(absolute);
  } catch {
    return null;
  }
  return allowed.has(parsed.origin) ? parsed.toString() : null;
}

/** Site origin for absolute schema URLs (canonical/breadcrumb items). */
function siteOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jadwal.qa').origin;
  } catch {
    return 'https://jadwal.qa';
  }
}

/**
 * Fetch the public activity record. Shared by generateMetadata and the
 * layout body — Next.js dedupes the two identical fetches into one request.
 */
async function fetchActivity(slug: string): Promise<PublicActivity | null> {
  // Server-side fetch needs an ABSOLUTE base. NEXT_PUBLIC_API_URL is the
  // relative "/api" proxy path in prod (no origin on the server → fetch throws →
  // OG/JSON-LD silently degrade). API_PROXY_TARGET is the absolute internal API
  // URL set in prod (see next.config.ts); prefer it for this server-side call.
  const internalUrl = process.env.INTERNAL_API_URL || process.env.API_PROXY_TARGET || process.env.NEXT_PUBLIC_API_URL;
  if (!internalUrl) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), META_FETCH_TIMEOUT_MS);
    const res = await fetch(
      `${internalUrl}/catalog/activities/${encodeURIComponent(slug)}`,
      { signal: controller.signal, next: { revalidate: 60 }, headers: { Accept: 'application/json' } },
    );
    clearTimeout(timer);
    if (res.ok) return (await res.json()) as PublicActivity;
  } catch {
    /* network / timeout / non-2xx — caller falls back */
  }
  return null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const cookieStore = await cookies();
  const lang = cookieStore.get('jadwal_lang')?.value === 'ar' ? 'ar' : 'en';

  const fallback: Metadata = {
    title: 'Jadwal',
    description:
      lang === 'ar'
        ? 'اكتشف واحجز أفضل الأنشطة والتجارب في الخليج'
        : 'Discover and book the best activities and experiences in the Gulf',
  };

  const activity = await fetchActivity(slug);
  if (!activity) return fallback;

  const title =
    (lang === 'ar' ? activity.titleAr : activity.titleEn) || activity.titleEn || 'Jadwal';
  const description = safeDescription(
    lang === 'ar' ? activity.descriptionAr : activity.descriptionEn,
  );
  const image = absoluteImageUrl(activity.coverImage);

  const og: NonNullable<Metadata['openGraph']> = {
    title,
    description: description || undefined,
    type: 'website',
    siteName: 'Jadwal',
    locale: lang === 'ar' ? 'ar_QA' : 'en_US',
  };
  if (image) og.images = [{ url: image, width: 1200, height: 630, alt: title }];

  const twitter: NonNullable<Metadata['twitter']> = {
    card: image ? 'summary_large_image' : 'summary',
    title,
    description: description || undefined,
  };
  if (image) twitter.images = [image];

  return {
    title,
    description: description || undefined,
    alternates: { canonical: `/activity/${slug}` },
    openGraph: og,
    twitter,
  };
}

export default async function ActivityLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const cookieStore = await cookies();
  const lang = cookieStore.get('jadwal_lang')?.value === 'ar' ? 'ar' : 'en';
  const activity = await fetchActivity(slug);

  // No activity (404 / API down) → render the page without schema.
  if (!activity) return <>{children}</>;

  const origin = siteOrigin();
  const activityUrl = `${origin}/activity/${slug}`;
  const title =
    (lang === 'ar' ? activity.titleAr : activity.titleEn) || activity.titleEn || 'Jadwal';
  const description = safeDescription(
    lang === 'ar' ? activity.descriptionAr : activity.descriptionEn,
  );
  const image = absoluteImageUrl(activity.coverImage);
  const price = activity.pricePerPerson != null ? Number(activity.pricePerPerson) : null;
  const currency = activity.country?.currencyCode || 'QAR';
  const brand = lang === 'ar'
    ? activity.vendor?.businessNameAr || activity.vendor?.businessNameEn
    : activity.vendor?.businessNameEn;
  const categoryName = lang === 'ar' ? activity.category?.nameAr : activity.category?.nameEn;
  const categorySlug = activity.category?.slug;
  const reviewCount = activity.reviewCount ?? 0;
  const avgRating = activity.avgRating ?? 0;

  // ── Product (+ Offer + AggregateRating) ──
  const product: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: title,
    url: activityUrl,
  };
  if (description) product.description = description;
  if (image) product.image = [image];
  if (brand) product.brand = { '@type': 'Brand', name: brand };
  if (price != null && Number.isFinite(price) && price >= 0) {
    product.offers = {
      '@type': 'Offer',
      price: price.toFixed(2),
      priceCurrency: currency,
      availability: 'https://schema.org/InStock',
      url: activityUrl,
    };
  }
  if (reviewCount > 0 && avgRating > 0) {
    product.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: avgRating.toFixed(1),
      reviewCount: String(reviewCount),
      bestRating: '5',
      worstRating: '1',
    };
  }

  // ── BreadcrumbList: Home → [Category] → Activity ──
  const crumbs: Array<Record<string, unknown>> = [
    { '@type': 'ListItem', position: 1, name: lang === 'ar' ? 'الرئيسية' : 'Home', item: origin },
  ];
  if (categoryName && categorySlug) {
    crumbs.push({
      '@type': 'ListItem',
      position: 2,
      name: categoryName,
      item: `${origin}/explore?category=${encodeURIComponent(categorySlug)}`,
    });
  }
  crumbs.push({ '@type': 'ListItem', position: crumbs.length + 1, name: title, item: activityUrl });
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs,
  };

  return (
    <>
      <JsonLd data={product} />
      <JsonLd data={breadcrumb} />
      {children}
    </>
  );
}
