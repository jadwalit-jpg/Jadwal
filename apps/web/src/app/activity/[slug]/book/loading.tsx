import { BookActivityPageSkeleton } from '@/components/ui/skeletons';

/**
 * Route-level loading boundary for `/activity/[slug]/book`. Renders the
 * same shape skeleton that `page.tsx` uses inside its `activityLoading`
 * early-return, just without the navbar above. Result: continuous
 * skeleton across cold-nav → hydration → query, no spinner→skeleton jump.
 */
export default function Loading() {
  return <BookActivityPageSkeleton />;
}
