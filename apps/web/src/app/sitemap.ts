import type { MetadataRoute } from 'next';

/**
 * sitemap.xml — auto-generated at build time by Next.js App Router.
 *
 * Lists the static + commonly-crawled public routes. Dynamic routes
 * (per-activity, per-vendor, per-category) are intentionally NOT
 * pulled from the API at build time because:
 *   1. The build runs in CI without DB access — would 500 the build.
 *   2. Activities and vendors change frequently — a stale sitemap is
 *      worse than no sitemap. We rely on Cloudflare's "Crawler Hints"
 *      (already enabled) to notify Google when content changes.
 *   3. Locale-aware URL generation belongs in middleware, not the build.
 *
 * If we later want a deeper sitemap (every activity), the right move is
 * a Next.js Route Handler at /sitemap-activities.xml that fetches at
 * request-time with caching, then we add a sitemap-index here pointing
 * to both this static file and the dynamic one.
 */

const BASE_URL = 'https://jadwal.qa';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      // The perf-readied homepage variant. Listed at priority 0.95 (just
      // below the root `/`) so it surfaces in search until it formally
      // replaces `/home`, at which point this entry can move back to the
      // root URL.
      url: `${BASE_URL}/home-test`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.95,
    },
    {
      url: `${BASE_URL}/explore`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/offers`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/about`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/privacy`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/terms`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.5,
    },
  ];
}
