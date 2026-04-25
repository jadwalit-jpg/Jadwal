'use client';

import { useAuth } from '@/context/auth-context';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function VendorSlugLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  useEffect(() => {
    if (loading) return;
    if (!user?.vendor) return;
    // If the slug in URL doesn't match the vendor's actual slug, redirect
    if (slug !== user.vendor.slug) {
      const currentPath = window.location.pathname;
      const correctedPath = currentPath.replace(`/vendor/${slug}`, `/vendor/${user.vendor.slug}`);
      router.replace(correctedPath);
    }
  }, [loading, user, slug, router]);

  return <>{children}</>;
}
