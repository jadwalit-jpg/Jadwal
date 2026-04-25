import { ActivityGridSkeleton } from '@/components/ui/skeletons';

/**
 * Kept as grid-shaped skeleton (not RouteSpinner). Explore has no page-level
 * full-page `isLoading` cover — each card uses its own inline skeleton — so a
 * grid skeleton here gives a smooth "shape preview" that flows into the real
 * grid with no visible flash. Matches Next.js's recommended loading.tsx style.
 */
export default function Loading() {
  return <ActivityGridSkeleton />;
}
