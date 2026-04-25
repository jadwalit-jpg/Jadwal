'use client';

import { RoleGuard } from '@/components/role-guard';

export default function VendorLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allowedRoles={['VENDOR']}>
      {children}
    </RoleGuard>
  );
}
