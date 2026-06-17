/**
 * /explore — server wrapper. Fetches the default page-1 (unfiltered) activity
 * list server-side and seeds it into the client filter tool's react-query cache
 * as `initialData`, so the activity-card grid (with real `/activity/[slug]`
 * links) is present in the crawlable SSR HTML instead of an empty skeleton.
 *
 * The interactive filtering / search / pagination is unchanged — it's still the
 * same client component (`explore-client.tsx`); we only pre-warm the default
 * view. Any ?filter permutation fetches fresh on the client (and is
 * canonicalised to /explore by `layout.tsx`, so filtered variants aren't
 * indexed). Page metadata + canonical live in `layout.tsx`.
 */

import { fetchActivities } from '@/lib/seo-fetch';
import ExploreClient, {
  type ActivitiesResponse,
} from './_components/explore-client';

// Render per request so the server-fetched default grid lands in the SSR HTML
// (the layout already reads the lang cookie → dynamic; this is explicit). The
// activity fetch keeps its own ISR `revalidate`, so the data stays cached.
export const dynamic = 'force-dynamic';

const PAGE_LIMIT = 20;

export default async function ExplorePage() {
  const { data, total } = await fetchActivities({ page: 1, limit: PAGE_LIMIT });

  // Build the ActivitiesResponse shape the client's useQuery expects. The list
  // endpoint returns a superset of ActivityCard fields (the client reads them
  // all), so the runtime data is complete even though seo-fetch types it leaner.
  const initialActivities: ActivitiesResponse | null = data.length
    ? ({
        data,
        total,
        page: 1,
        limit: PAGE_LIMIT,
        totalPages: Math.max(1, Math.ceil(total / PAGE_LIMIT)),
      } as unknown as ActivitiesResponse)
    : null;

  return <ExploreClient initialActivities={initialActivities} />;
}
