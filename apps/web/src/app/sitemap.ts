import type { MetadataRoute } from 'next';
import { launchedLandings } from '@/lib/seo-landings';
import { publishedGuides } from '@/lib/seo-guides';
import { localePath } from '@/lib/locale-path';

/**
 * sitemap.xml — static routes + dynamic per-activity / per-category URLs.
 *
 * Dynamic URLs are fetched at request time from the API's
 * GET /catalog/sitemap-urls (bulk slug export) and the result is cached for
 * 10 minutes via `revalidate` — so crawlers get a complete, reasonably-fresh
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
// Google ignores everything past 50,000 URLs in a single sitemap file. This
// file assembles static routes + landing pages + guides + per-activity URLs,
// so it is the authoritative total cap (the API export also leaves headroom).
// Entries are appended static -> landings/guides -> activities, so if the cap
// ever bites it sheds trailing ACTIVITY urls first and never the hand-written
// pages. Category filter urls are not emitted at all — see below.
const MAX_SITEMAP_URLS = 50000;

// How long a generated sitemap is served before it is regenerated (ISR).
//
// This was 1h, and that turned out to be a real SEO hole rather than a tuning
// choice. CI builds have no API access, so `next build` bakes the STATIC-ONLY
// fallback into the sitemap — and Next.js then treats that baked copy as FRESH
// for the whole window. So every deploy served a sitemap containing zero of the
// 50 activity URLs for a full hour, and a day with several deploys kept it
// empty end to end. Measured on 2026-08-25: six deploys, and the live sitemap
// reported 0 activity URLs across an 86-minute watch.
//
// 10 minutes bounds that blind spot to something harmless while staying far
// cheaper than per-crawl generation: the export is one bulk query, and this is
// regenerated on demand (only when something actually requests the sitemap),
// not on a timer.
export const revalidate = 600;

/**
 * hreflang alternates for a public path (bilingual /ar URLs, SEO P1#4). The
 * entry's `url` stays the English (canonical) URL; Google discovers the Arabic
 * twin via the `xhtml:link` alternates Next.js emits from this. `path` is the
 * English app-relative path ('' = home, '/explore', `/activity/x`, …).
 */
function langAlternates(path: string): { languages: Record<string, string> } {
  const en = `${BASE_URL}${path}`;
  const ar = `${BASE_URL}${localePath(path || '/', 'ar')}`;
  return { languages: { en, ar, 'x-default': en } };
}

interface SitemapUrls {
  activities: Array<{ slug: string; updatedAt: string }>;
  // Still returned by the API; deliberately NOT emitted as sitemap urls.
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
  { path: '/redsea', changeFrequency: 'monthly', priority: 0.8 },
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
      // Must not exceed `revalidate` above, or the regenerated sitemap would
      // just re-serve an hour-old fetch and the shorter window would be a lie.
      next: { revalidate: 600 },
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
    alternates: langAlternates(r.path),
  }));

  // Keyword SEO landing pages — only the LAUNCHED ones (real inventory). Dormant
  // (noindex) landings are intentionally excluded so nothing thin gets indexed.
  for (const l of launchedLandings()) {
    entries.push({
      url: `${BASE_URL}/${l.slug}`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: l.priority,
      alternates: langAlternates(`/${l.slug}`),
    });
  }

  // Published Tier-2 guides (dormant/unpublished excluded).
  for (const g of publishedGuides()) {
    entries.push({
      url: `${BASE_URL}/blog/${g.slug}`,
      lastModified: g.updated ? new Date(g.updated) : now,
      changeFrequency: 'monthly',
      priority: g.priority,
      alternates: langAlternates(`/blog/${g.slug}`),
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
        alternates: langAlternates(`/activity/${encodeURIComponent(a.slug)}`),
      });
    }
    // Category FILTER urls are deliberately NOT in the sitemap.
    // `/explore?category=x` is the Explore page with a filter applied, not a
    // distinct page: same layout, same intro copy, a subset of the same cards.
    // Submitting several of them asks Google to choose between near-duplicates
    // of one page, which splits ranking signals instead of concentrating them.
    // The indexable home for a category keyword is a dedicated landing page in
    // lib/seo-landings.ts (e.g. /water-activities-qatar), which has its own h1,
    // its own copy and its own inventory check — those ARE listed above.
    // Flagged by the SEO team's sitemap screenshot, 2026-08-25.
  }

  // Hard guarantee we never emit more than Google reads (it silently drops
  // the overflow otherwise). Static routes + activities come first, so any
  // truncation only sheds trailing category URLs.
  return entries.slice(0, MAX_SITEMAP_URLS);
}
