/**
 * Conditional shell that wraps customer-facing routes with GeoProvider +
 * LazyPrompts, and renders nothing extra for staff (admin / vendor) or
 * auth routes.
 *
 * Why: GeoProvider runs an /api/geo/detect call + an effect to detect the
 * user's country on mount. PhonePrompt + PushPrompt fetch user state via
 * useGeo. Neither is needed on admin / vendor / auth pages — those users
 * don't see "verify your phone" / "enable push" prompts, and admin /
 * vendor flows aren't country-scoped. Skipping the provider on those
 * routes saves ~50-150ms TBT per route.
 *
 * Verified safe: grepped useGeo usage across the entire app and confirmed
 * only customer-facing files (home, explore, activity/[slug]/book, profile)
 * call it. Admin and vendor files have ZERO useGeo references.
 */
'use client';

import { usePathname } from 'next/navigation';
import { GeoProvider } from '@/context/geo-context';
import { LazyPrompts } from '@/components/lazy-prompts';

// Route prefixes that do NOT need GeoProvider:
//   - /admin/*  → staff, no country-scoped data
//   - /vendor/* → staff, no country-scoped data
//   - auth-flow routes → user not logged in, prompts wouldn't fire anyway
const NO_GEO_PREFIXES = [
  '/admin',
  '/vendor',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
] as const;

function needsGeoContext(pathname: string | null): boolean {
  if (!pathname) return true; // safe default — wrap with Geo
  return !NO_GEO_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function CustomerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (!needsGeoContext(pathname)) {
    // Staff / auth route: no Geo, no prompts. Pass children through.
    return <>{children}</>;
  }
  return (
    <GeoProvider>
      {children}
      <LazyPrompts />
    </GeoProvider>
  );
}
