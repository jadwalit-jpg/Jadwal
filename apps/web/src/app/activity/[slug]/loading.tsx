import { ActivityDetailPageSkeleton } from '@/components/ui/skeletons';

/**
 * Route-level loading boundary for `/activity/[slug]`. Uses the SAME
 * shape skeleton that `page.tsx`'s loading early-return renders (just
 * without the navbar above it, which the page provides during the
 * query phase). Result: cold navigation → page hydration is a single
 * continuous skeleton frame, no spinner-to-skeleton jump.
 */
export default function Loading() {
  return <ActivityDetailPageSkeleton />;
}
