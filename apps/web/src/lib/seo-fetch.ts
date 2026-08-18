import 'server-only';

/**
 * Server-side catalog fetch for SEO pages (keyword landing pages, etc.).
 *
 * Mirrors the proven pattern in `app/activity/[slug]/layout.tsx` + `app/sitemap.ts`:
 *  - an ABSOLUTE internal base URL (NEXT_PUBLIC_API_URL is the relative "/api"
 *    proxy with no origin server-side, so it can't be used here);
 *  - an AbortSignal timeout;
 *  - ISR `revalidate` so pages are regenerated hourly, not per request;
 *  - a SILENT graceful fallback (returns `{ data: [], total: 0 }`) so a fetch
 *    failure degrades the page (renders its SEO copy + an explore CTA) instead
 *    of throwing.
 *
 * No user input reaches the URL except values from the typed landing config
 * (allow-listed at build via generateStaticParams), so there is no SSRF/injection surface.
 */

const TIMEOUT_MS = 4000;
const REVALIDATE_SECONDS = 3600;

/** Absolute API base for server-side fetches, or null if unconfigured. */
export function apiBase(): string | null {
  return (
    process.env.INTERNAL_API_URL ||
    process.env.API_PROXY_TARGET ||
    process.env.NEXT_PUBLIC_API_URL ||
    null
  );
}

export interface PublicActivityCard {
  id: string;
  slug: string;
  titleEn: string;
  titleAr: string;
  pricePerPerson: number | string | null;
  coverImage: string | null;
  bookingType: 'HOURLY' | 'DAILY';
  city?: { nameEn?: string | null; nameAr?: string | null } | null;
  country?: { nameEn?: string | null; currencyCode?: string | null } | null;
  vendor?: { businessNameEn?: string | null; businessNameAr?: string | null; slug?: string | null } | null;
  avgRating?: number | null;
  reviewCount?: number | null;
}

export interface ActivityListResult {
  data: PublicActivityCard[];
  total: number;
}

/**
 * Fetch a page of public activities by filter (category slug OR free-text search,
 * + limit). Returns `{ data: [], total: 0 }` on any failure (timeout / network /
 * non-2xx / unconfigured base) — callers render gracefully.
 */
export async function fetchActivities(
  query: Record<string, string | number | undefined>,
): Promise<ActivityListResult> {
  const base = apiBase();
  if (!base) return { data: [], total: 0 };

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/catalog/activities?${qs.toString()}`, {
      signal: controller.signal,
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const json = await res.json();
      return {
        data: Array.isArray(json?.data) ? (json.data as PublicActivityCard[]) : [],
        total: typeof json?.total === 'number' ? json.total : 0,
      };
    }
  } catch {
    /* timeout / network / non-2xx → graceful empty */
  } finally {
    clearTimeout(timer); // always clear the abort timer, even when fetch throws
  }
  return { data: [], total: 0 };
}
