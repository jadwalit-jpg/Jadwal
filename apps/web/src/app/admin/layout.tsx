'use client';

import { usePathname } from 'next/navigation';
import { RoleGuard } from '@/components/role-guard';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Don't guard the login page
  if (pathname === '/admin/login') {
    return <>{children}</>;
  }

  return (
    <RoleGuard allowedRoles={['ADMIN']}>
      {children}
    </RoleGuard>
  );
}
