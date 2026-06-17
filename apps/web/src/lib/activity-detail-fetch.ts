import 'server-only';
import { cache } from 'react';

/**
 * Server-side fetch of ONE public activity by slug. Shared by the activity
 * route's `layout.tsx` (OG/Twitter metadata + Product/BreadcrumbList JSON-LD +
 * the 404 gate) and `page.tsx` (SSR `initialData` so the activity BODY — title,
 * description, reviews, schedule — lands in the crawlable HTML instead of a
 * loading skeleton). Wrapped in React `cache()` AND using identical `fetch`
 * options so the two consumers share ONE network call per request (Next.js
 * request-memoises identical fetches across generateMetadata + render).
 *
 * Returns a DISCRIMINATED result so the caller can tell a genuine 404 (the slug
 * doesn't exist / the listing or vendor isn't ACTIVE → the endpoint 404s →
 * real `notFound()`) apart from a transient blip (timeout / network / 5xx →
 * degrade gracefully; NEVER 404 a valid activity on an API hiccup). This is the
 * fix for the soft-404: previously a missing activity rendered a 200 + a
 * client-side "Activity Not Found" card.
 *
 * Mirrors the proven base-URL + AbortSignal + ISR pattern in `lib/seo-fetch.ts`
 * and `app/sitemap.ts`. No user input reaches the URL except the slug, which is
 * encodeURIComponent'd; there is no SSRF/injection surface (fixed internal base).
 */

const TIMEOUT_MS = 3000;
const REVALIDATE_SECONDS = 60;

export type ActivityFetchResult =
  | { status: 'ok'; activity: Record<string, unknown> }
  | { status: 'notfound' }
  | { status: 'error' };

/** Absolute API base for server-side fetches, or null if unconfigured. */
function apiBase(): string | null {
  return (
    process.env.INTERNAL_API_URL ||
    process.env.API_PROXY_TARGET ||
    process.env.NEXT_PUBLIC_API_URL ||
    null
  );
}

export const fetchActivityDetail = cache(
  async (slug: string): Promise<ActivityFetchResult> => {
    const base = apiBase();
    if (!base) return { status: 'error' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(
        `${base}/catalog/activities/${encodeURIComponent(slug)}`,
        {
          signal: controller.signal,
          next: { revalidate: REVALIDATE_SECONDS },
          headers: { Accept: 'application/json' },
        },
      );
      if (res.ok) {
        return { status: 'ok', activity: (await res.json()) as Record<string, unknown> };
      }
      // A 404 is authoritative (endpoint 404s non-ACTIVE / missing listings) →
      // the caller should real-404. Any other non-2xx is a server-side problem
      // we must NOT mistake for "this activity doesn't exist".
      if (res.status === 404) return { status: 'notfound' };
      return { status: 'error' };
    } catch {
      // timeout / network → transient; degrade, do not 404 a valid activity.
      return { status: 'error' };
    } finally {
      clearTimeout(timer);
    }
  },
);
