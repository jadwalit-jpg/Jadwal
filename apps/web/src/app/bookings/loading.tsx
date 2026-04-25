import { ListSkeleton } from '@/components/ui/skeletons';

/**
 * List skeleton — bookings list uses inline per-row skeletons, no stacking risk.
 */
export default function Loading() {
  return <ListSkeleton />;
}
