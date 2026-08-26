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

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  // Fetch for the country the request actually carries.
  //
  // Geo detection assigns a country on load and writes it into the URL, so
  // `?countryId=…` is the NORMAL arrival, not an edge case — and the previous
  // unfiltered-only fetch meant those arrivals were served skeletons while the
  // client refetched the same page. The card images then did not exist until
  // hydration plus a round-trip had completed, which is what LCP was waiting
  // for. See `initialCountryId` in explore-client.tsx.
  //
  // Only the country is honoured. Every other filter permutation still fetches
  // on the client — those are `noindex`, far less common, and seeding them
  // would multiply the server-side cache entries for no benefit.
  //
  // Not validated here: an unknown or malformed id simply returns no rows, and
  // `fetchActivities` already swallows a non-OK response into an empty result,
  // so the client falls back to fetching exactly as it did before.
  const countryId = typeof sp.countryId === 'string' ? sp.countryId : '';

  const { data, total } = await fetchActivities({
    page: 1,
    limit: PAGE_LIMIT,
    ...(countryId ? { countryId } : {}),
  });

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

  return (
    <ExploreClient
      initialActivities={initialActivities}
      initialCountryId={countryId}
    />
  );
}
