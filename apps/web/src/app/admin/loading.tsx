import { RouteSpinner } from '@/components/ui/route-spinner';

/**
 * Route-level loader for every /admin/* page. Spinner only — each admin page
 * renders its own shell with in-page skeletons for individual data queries.
 */
export default function Loading() {
  return <RouteSpinner label="Loading admin portal" />;
}
