import { ProfilePageSkeleton } from '@/components/ui/skeletons';

/**
 * Route-level loading boundary for `/profile`. Shape-matches the page so
 * the cold-navigation flash carries shape information instead of just a
 * spinner. The page itself already does the shell-unconditional + inline
 * `<ProfileSkeleton />` pattern for its `useQuery` state — that handles
 * the post-hydration data-fetch UX.
 */
export default function Loading() {
  return <ProfilePageSkeleton />;
}
