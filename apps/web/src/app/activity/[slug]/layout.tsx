/**
 * Per-activity metadata layout — emits Open Graph + Twitter Card tags
 * server-side so WhatsApp / Telegram / iMessage / Slack / Twitter render
 * a rich preview (cover image + title + description) when an activity
 * link is shared. The interactive client page underneath is unchanged.
 *
 * Why a layout (not the page itself): the activity detail page is a
 * client component (`'use client'`), and only server components can
 * export `generateMetadata`. A nested layout.tsx runs server-side per
 * request, fetches the public activity record, and emits the metadata
 * — without forcing the page itself to be rewritten.
 *
 * Security:
 *   - We hit the same /catalog/activities/:slug endpoint the public
 *     page uses; it already filters out non-ACTIVE activities and
 *     non-ACTIVE vendors with a 404. So OG previews can never leak a
 *     pending/rejected listing.
 *   - 3s AbortSignal timeout keeps a slow API from hanging the
 *     navigation request.
 *   - Description is truncated to 160 chars (the SEO + social-card
 *     standard) and stripped of any stray angle brackets defensively.
 *   - Image URL is normalised to an absolute origin so social
 *     scrapers can fetch it (relative paths break them).
 *   - On any error we fall back to brand-level metadata so the page
 *     still renders.
 *
 * Performance:
 *   - `next: { revalidate: 60 }` caches the metadata fetch for 60s
 *     across requests — same activity slug only hits the API once a
 *     minute under load. The client page below this still does its
 *     own (fresher) TanStack-Query fetch for live data like reviews.
 */

import type { Metadata } from 'next';
import { cookies } from 'next/headers';

const META_FETCH_TIMEOUT_MS = 3000;
const DESCRIPTION_MAX = 160;

interface PublicActivity {
  titleEn?: string;
  titleAr?: string;
  descriptionEn?: string | null;
  descriptionAr?: string | null;
  coverImage?: string | null;
}

/** Strip stray HTML brackets and clamp to a social-card-friendly length. */
function safeDescription(raw: string | null | undefined): string {
  if (!raw) return '';
  const stripped = raw.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return stripped.length > DESCRIPTION_MAX
    ? stripped.slice(0, DESCRIPTION_MAX - 1) + '…'
    : stripped;
}

// Derive the asset origin (e.g. http://127.0.0.1:4000) from the API URL.
function assetOrigin(): string | null {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) return null;
  try {
    return new URL(apiUrl).origin;
  } catch {
    return null;
  }
}

/**
 * Build an absolute URL for the cover image, AND drop the image entirely
 * if it points to an off-domain origin. Defense-in-depth: vendor activity
 * approval already gates what's published, but if a malicious cover URL
 * ever slipped past review (e.g. `http://evil.cdn/x.jpg`) we don't want
 * Jadwal-branded share previews emitting it. Allowed origin is whatever
 * NEXT_PUBLIC_API_URL resolves to (the CDN/upload host). Future hosts can
 * be added to the allowlist below.
 */
function absoluteImageUrl(coverImage: string | null | undefined): string | null {
  if (!coverImage) return null;
  const origin = assetOrigin();
  if (!origin) return null;

  let absolute: string;
  if (/^https?:\/\//i.test(coverImage)) {
    absolute = coverImage;
  } else if (coverImage.startsWith('/')) {
    absolute = `${origin}${coverImage}`;
  } else {
    absolute = `${origin}/${coverImage}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(absolute);
  } catch {
    return null;
  }

  // Allow only the configured asset origin. Add future hosts (CDN, S3
  // public bucket, etc.) here when they come online.
  const allowed = new Set<string>([origin]);
  return allowed.has(parsed.origin) ? parsed.toString() : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  // Pick language from the same cookie the rest of the app reads, so
  // shared links preserve the language the sharer was browsing in.
  const cookieStore = await cookies();
  const lang = cookieStore.get('jadwal_lang')?.value === 'ar' ? 'ar' : 'en';

  // SSR-time fetches need a URL that resolves from the rendering process.
  // Two scenarios:
  //   1. Docker dev/prod: web container can't reach the api container via
  //      its sibling network name on its loopback interface. Use
  //      INTERNAL_API_URL=http://api:4000/api set in docker-compose / ECS.
  //   2. Plain `npm run dev` on host: Node 18+ resolves `127.0.0.1` IPv4-
  //      first which is what we want. The browser-facing API URL must
  //      already be IPv4 (set NEXT_PUBLIC_API_URL=http://127.0.0.1:4000/api
  //      for non-Docker dev — same caveat applies on Windows where
  //      localhost-as-IPv6 trips Node's HTTP client).
  const internalUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL;

  const fallback: Metadata = {
    title: 'Jadwal',
    description:
      lang === 'ar'
        ? 'اكتشف واحجز أفضل الأنشطة والتجارب في الخليج'
        : 'Discover and book the best activities and experiences in the Gulf',
  };

  if (!internalUrl) return fallback;

  let activity: PublicActivity | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), META_FETCH_TIMEOUT_MS);
    const res = await fetch(
      `${internalUrl}/catalog/activities/${encodeURIComponent(slug)}`,
      {
        signal: controller.signal,
        next: { revalidate: 60 },
        headers: { Accept: 'application/json' },
      },
    );
    clearTimeout(timer);
    if (res.ok) activity = (await res.json()) as PublicActivity;
  } catch {
    /* network / timeout / non-2xx — fall through to fallback */
  }

  if (!activity) return fallback;

  const title =
    (lang === 'ar' ? activity.titleAr : activity.titleEn) ||
    activity.titleEn ||
    'Jadwal';
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
    openGraph: og,
    twitter,
  };
}

export default function ActivityLayout({ children }: { children: React.ReactNode }) {
  return children;
}
