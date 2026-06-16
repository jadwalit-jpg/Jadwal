import type { MetadataRoute } from 'next';
import { launchedLandings } from '@/lib/seo-landings';
import { publishedGuides } from '@/lib/seo-guides';

/**
 * sitemap.xml — static routes + dynamic per-activity / per-category URLs.
 *
 * Dynamic URLs are fetched at request time from the API's
 * GET /catalog/sitemap-urls (bulk slug export) and the result is cached for
 * an hour via `revalidate` — so crawlers get a complete, reasonably-fresh
 * URL set without hitting the DB on every request.
 *
 * Robustness: the fetch is wrapped in a timeout + try/catch and FALLS BACK
 * to the static route list on any error. This is why the original build-time
 * concern (CI builds run without DB access → a fetch would 500 the build) no
 * longer applies: during `next build` in CI the fetch simply fails and we
 * emit the static-only sitemap; once deployed (API reachable) the first
 * post-revalidation request fills in the dynamic URLs.
 */

const BASE_URL = 'https://jadwal.qa';
// 10s (was 4s): the bulk slug export is larger than a single-page fetch, and the
// server-side call runs over the internal ALB hop whose first connection on a
// COLD container can exceed a tight 4s budget — which made the very first
// post-deploy generation time out and cache the static-only fallback for an
// hour. The sitemap is generated in the background (ISR, hourly), so no user
// ever waits on this and a longer ceiling is free.
const FETCH_TIMEOUT_MS = 10000;
// Google ignores everything past 50,000 URLs in a single sitemap file. We
// assemble static + activities + categories here, so this is the authoritative
// total cap (the API also leaves headroom). Entries are ordered static →
// activities → categories, so if the cap ever bites, the least SEO-critical
// entries (categories) drop first.
const MAX_SITEMAP_URLS = 50000;

// Cache the generated sitemap for 1h (ISR) — not regenerated per crawl.
export const revalidate = 3600;

interface SitemapUrls {
  activities: Array<{ slug: string; updatedAt: string }>;
  categories: Array<{ slug: string; updatedAt: string }>;
}

const STATIC_ROUTES: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
  priority: number;
}> = [
  { path: '', changeFrequency: 'daily', priority: 1.0 },
  { path: '/explore', changeFrequency: 'daily', priority: 0.9 },
  { path: '/offers', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/blog', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.5 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.5 },
];

async function fetchSitemapUrls(): Promise<SitemapUrls | null> {
  // Server-side fetch needs an ABSOLUTE base. In production NEXT_PUBLIC_API_URL
  // is the relative "/api" (the browser proxy path), which has no origin on the
  // server → the fetch throws → we silently fell back to the static-only sitemap
  // (zero /activity URLs). API_PROXY_TARGET is the absolute internal API URL set
  // in prod (see next.config.ts), so prefer it for this server-side call.
  const api = process.env.INTERNAL_API_URL || process.env.API_PROXY_TARGET || process.env.NEXT_PUBLIC_API_URL;
  if (!api) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`${api}/catalog/sitemap-urls`, {
      signal: controller.signal,
      next: { revalidate: 3600 },
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);
    if (res.ok) return (await res.json()) as SitemapUrls;
  } catch {
    /* network / timeout / non-2xx — fall back to static routes */
  }
  return null;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const entries: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: `${BASE_URL}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  // Keyword SEO landing pages — only the LAUNCHED ones (real inventory). Dormant
  // (noindex) landings are intentionally excluded so nothing thin gets indexed.
  for (const l of launchedLandings()) {
    entries.push({
      url: `${BASE_URL}/${l.slug}`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: l.priority,
    });
  }

  // Published Tier-2 guides (dormant/unpublished excluded).
  for (const g of publishedGuides()) {
    entries.push({
      url: `${BASE_URL}/blog/${g.slug}`,
      lastModified: g.updated ? new Date(g.updated) : now,
      changeFrequency: 'monthly',
      priority: g.priority,
    });
  }

  const dynamic = await fetchSitemapUrls();
  if (dynamic) {
    for (const a of dynamic.activities ?? []) {
      if (!a?.slug) continue;
      entries.push({
        url: `${BASE_URL}/activity/${encodeURIComponent(a.slug)}`,
        lastModified: a.updatedAt ? new Date(a.updatedAt) : now,
        changeFrequency: 'weekly',
        priority: 0.8,
      });
    }
    for (const c of dynamic.categories ?? []) {
      if (!c?.slug) continue;
      entries.push({
        url: `${BASE_URL}/explore?category=${encodeURIComponent(c.slug)}`,
        lastModified: c.updatedAt ? new Date(c.updatedAt) : now,
        changeFrequency: 'weekly',
        priority: 0.6,
      });
    }
  }

  // Hard guarantee we never emit more than Google reads (it silently drops
  // the overflow otherwise). Static routes + activities come first, so any
  // truncation only sheds trailing category URLs.
  return entries.slice(0, MAX_SITEMAP_URLS);
}
