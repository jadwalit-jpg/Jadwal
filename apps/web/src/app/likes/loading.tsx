import { ActivityGridSkeleton } from '@/components/ui/skeletons';

/**
 * Grid skeleton — likes page uses inline per-card skeletons, no stacking risk.
 */
export default function Loading() {
  return <ActivityGridSkeleton />;
}
