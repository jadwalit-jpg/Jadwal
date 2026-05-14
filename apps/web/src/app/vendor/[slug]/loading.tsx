import { SidebarPageSkeleton } from '@/components/ui/skeletons';

/**
 * Route-level loader for every `/vendor/[slug]/*` page. Uses the shared
 * `SidebarPageSkeleton` so the cold-nav flash carries the vendor-portal
 * shape (sidebar + content area) instead of a bare spinner.
 *
 * Shown only during the React Server Component transition before the
 * page bundle is ready — once the page mounts, its own inline skeletons
 * (or shell-unconditional pattern) take over.
 */
export default function Loading() {
  return <SidebarPageSkeleton />;
}
