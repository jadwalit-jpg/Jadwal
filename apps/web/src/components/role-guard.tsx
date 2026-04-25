'use client';

import { useAuth } from '@/context/auth-context';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { RouteSpinner } from '@/components/ui/route-spinner';

interface RoleGuardProps {
  allowedRoles: string[];
  children: React.ReactNode;
}

/**
 * Client-side role guard. Redirects users who don't have the required role.
 * - ADMIN trying to access vendor → /admin/dashboard
 * - VENDOR trying to access admin → /vendor/dashboard
 * - CUSTOMER trying to access admin/vendor → /
 * - Unauthenticated → /login (handled by middleware, this is a fallback)
 *
 * Intentionally renders NOTHING (null) during an unauthorized state — the
 * App Router's route-level `loading.tsx` owns the visible loading UI during
 * the redirect transition. Previously this component painted its own three-
 * card skeleton which stacked on top of the route boundary's skeleton during
 * logout, producing the "double skeleton" flash. A small centered spinner
 * shows only while the initial session lookup is still resolving.
 */
export function RoleGuard({ allowedRoles, children }: RoleGuardProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;

    if (!user) {
      if (pathname.startsWith('/admin')) {
        router.replace('/admin/login');
      } else if (pathname.startsWith('/vendor')) {
        router.replace('/register/vendor');
      } else {
        router.replace('/');
      }
      return;
    }

    if (!allowedRoles.includes(user.role)) {
      switch (user.role) {
        case 'ADMIN':
          router.replace('/admin/dashboard');
          break;
        case 'VENDOR':
          router.replace(`/vendor/${user.vendor?.slug ?? 'portal'}/dashboard`);
          break;
        default:
          router.replace('/');
          break;
      }
    }
  }, [loading, user, allowedRoles, router, pathname]);

  // Still resolving the session → show a lightweight spinner. This only runs
  // on first mount when AuthProvider is hydrating the `/auth/me` lookup.
  if (loading) {
    return <RouteSpinner label="Checking your account" />;
  }

  // Unauthorised (logged out, wrong role, or redirect in flight). Render
  // nothing so the App Router's loading.tsx owns the visual during
  // navigation — no competing skeleton, no stacked fallbacks.
  if (!user || !allowedRoles.includes(user.role)) {
    return null;
  }

  return <>{children}</>;
}
