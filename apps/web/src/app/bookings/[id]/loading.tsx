import { BookingDetailPageSkeleton } from '@/components/ui/skeletons';

/**
 * Route-level loading boundary for `/bookings/[id]`. Shape-matches the
 * page so cold-navigation carries shape information instead of a
 * spinner. The page itself already does the shell-unconditional + inline
 * `<BookingDetailSkeleton />` pattern for its `useQuery` state.
 */
export default function Loading() {
  return <BookingDetailPageSkeleton />;
}
