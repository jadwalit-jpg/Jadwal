'use client';

import { usePathname } from 'next/navigation';
import { RoleGuard } from '@/components/role-guard';
import VendorTranslationsGate from '@/components/vendor-translations-gate';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Don't guard the login page
  if (pathname === '/admin/login') {
    return <>{children}</>;
  }

  return (
    <RoleGuard allowedRoles={['ADMIN']}>
      {/* Admin activity screens reuse the vendor components, so they need the
          same split-out vendor.* strings. Deliberately NOT applied to
          /admin/login above: that page uses no vendor keys and must not wait
          on an extra chunk before you can sign in. */}
      <VendorTranslationsGate>{children}</VendorTranslationsGate>
    </RoleGuard>
  );
}
