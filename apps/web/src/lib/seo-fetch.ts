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
  /** HOURLY → hours, DAILY → nights; null = flexible (per night). */
  durationValue?: number | null;
  /** PER_PERSON = price × guests; PER_UNIT = flat price for the whole group/unit. */
  pricingModel?: 'PER_PERSON' | 'PER_UNIT' | string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
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

/* ─── Sub-category filtering (landing pages) ─────────────────────────────
 *
 * The catalog's `category=<slug>` filter matches a listing's MAIN category
 * (or its parent) only; sub-categories are ignored. `categoryId=<id>` DOES
 * honour child categories (an activity tagged with that sub-category, or
 * tagged with just the parent and no sub-category). So a landing page that
 * wants "Desert Camp + camping" resolves those slugs to ids via the public
 * categories endpoint and runs one list query per sub-category, merging the
 * results. Both fetches share the same hourly ISR cache + graceful fallback.
 */

interface PublicCategory {
  id: string;
  slug: string;
  children?: { id: string; slug: string }[] | null;
}

/** Map of category/sub-category slug → id, or an empty map on any failure. */
export async function fetchCategorySlugIds(): Promise<Map<string, string>> {
  const base = apiBase();
  const map = new Map<string, string>();
  if (!base) return map;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/catalog/categories`, {
      signal: controller.signal,
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const json = (await res.json()) as unknown;
      for (const c of Array.isArray(json) ? (json as PublicCategory[]) : []) {
        if (c?.slug && c?.id) map.set(c.slug, c.id);
        for (const ch of c?.children ?? []) if (ch?.slug && ch?.id) map.set(ch.slug, ch.id);
      }
    }
  } catch {
    /* timeout / network / non-2xx → empty map → caller renders its empty state */
  } finally {
    clearTimeout(timer);
  }
  return map;
}

/**
 * Activities for a landing-page filter. `subCategories` (slugs) is resolved to
 * ids and queried per sub-category; otherwise the filter is passed straight to
 * `fetchActivities` (category slug or free-text search). Results are de-duped by
 * id, kept in listing order, and capped at `limit`.
 */
export async function fetchActivitiesForLanding(
  filter: { category?: string; search?: string; subCategories?: string[] },
  limit: number,
): Promise<ActivityListResult> {
  if (!filter.subCategories?.length) {
    return fetchActivities({ category: filter.category, search: filter.search, limit });
  }
  const ids = await fetchCategorySlugIds();
  const categoryIds = filter.subCategories
    .map((slug) => ids.get(slug))
    .filter((id): id is string => !!id);
  if (categoryIds.length === 0) return { data: [], total: 0 };

  const pages = await Promise.all(categoryIds.map((categoryId) => fetchActivities({ categoryId, limit })));
  const seen = new Set<string>();
  const data: PublicActivityCard[] = [];
  for (const page of pages) {
    for (const a of page.data) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      data.push(a);
    }
  }
  // Newest first across the merged set (each page is already createdAt desc).
  return { data: data.slice(0, limit), total: data.length };
}
