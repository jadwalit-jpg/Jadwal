/**
 * /activity/[slug] — server wrapper. Fetches the activity server-side and seeds
 * it into the client island's react-query cache as `initialData`, so the
 * activity BODY (title, description, reviews, schedule, location) is present in
 * the crawlable SSR HTML instead of a loading skeleton. The body is still the
 * SAME client component (`activity-detail-client.tsx`) — gallery, booking
 * widget, like/share, lightbox, map and the review form all keep working
 * exactly as before; we only pre-warm the data.
 *
 * The 404 gate + OG/Twitter metadata + Product/BreadcrumbList JSON-LD live in
 * `layout.tsx` (which shares this same request-memoised fetch). This file owns
 * NO metadata — the layout does.
 */

import { fetchActivityDetail } from '@/lib/activity-detail-fetch';
import ActivityDetailClient, {
  type ActivityDetail,
} from './_components/activity-detail-client';

// Render per request so the server-fetched body lands in the SSR HTML for every
// visitor (the layout already reads the lang cookie → dynamic; this is explicit).
// The activity fetch keeps its own ISR `revalidate`, so data stays cached.
export const dynamic = 'force-dynamic';

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await fetchActivityDetail(slug);
  // A genuine 404 is already turned into a real notFound() by layout.tsx
  // (generateMetadata runs first). Here we only seed initialData on success; on
  // an API blip we pass null and the client island fetches on mount as before.
  const initialActivity =
    result.status === 'ok' ? (result.activity as unknown as ActivityDetail) : null;

  return <ActivityDetailClient slug={slug} initialActivity={initialActivity} />;
}
