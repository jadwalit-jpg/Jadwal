'use client';

import { RoleGuard } from '@/components/role-guard';
import VendorTranslationsGate from '@/components/vendor-translations-gate';

export default function VendorLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allowedRoles={['VENDOR']}>
      {/* vendor.* strings are split out of the main locale bundle (79 KB) and
          merged in here — see components/vendor-translations-gate.tsx. */}
      <VendorTranslationsGate>{children}</VendorTranslationsGate>
    </RoleGuard>
  );
}
