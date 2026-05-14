import { SidebarPageSkeleton } from '@/components/ui/skeletons';

/**
 * Route-level loader for `/admin/*`. Uses the shared `SidebarPageSkeleton`
 * so the cold-nav flash carries the admin-portal shape (sidebar +
 * content area) instead of a bare spinner.
 *
 * Once the admin page chunk loads, `admin-layout.tsx` mounts and may
 * briefly render its own `AdminLayoutSkeleton` while auth resolves —
 * both are sidebar-shaped, so the transition is shape-stable.
 */
export default function Loading() {
  return <SidebarPageSkeleton />;
}
