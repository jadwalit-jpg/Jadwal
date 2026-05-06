'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import {
  LayoutDashboard,
  Users,
  Store,
  CalendarRange,
  BookOpen,
  Wallet,
  Ticket,
  MessageSquare,
  Settings,
  LogOut,
  Sun,
  Moon,
  ClipboardList,
  TrendingUp,
  Tag,
  MapPin,
  Award,
  UserCircle,
  Undo2,
  X,
} from 'lucide-react';

const navItems = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/vendors', label: 'Vendors', icon: Store },
  { href: '/admin/activities', label: 'Activities', icon: CalendarRange },
  { href: '/admin/categories', label: 'Categories', icon: Tag },
  { href: '/admin/cities', label: 'Countries & Cities', icon: MapPin },
  { href: '/admin/bookings', label: 'Bookings', icon: BookOpen },
  { href: '/admin/refunds', label: 'Refund Queue', icon: Undo2 },
  { href: '/admin/payouts', label: 'Payouts', icon: Wallet },
  { href: '/admin/coupons', label: 'Coupons', icon: Ticket },
  { href: '/admin/reviews', label: 'Reviews', icon: MessageSquare },
  { href: '/admin/loyalty', label: 'Loyalty (WANASA)', icon: Award },
  { href: '/admin/trending', label: 'Trending', icon: TrendingUp },
  { href: '/admin/audit-logs', label: 'Audit Logs', icon: ClipboardList },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
  { href: '/admin/profile', label: 'My Profile', icon: UserCircle },
] as { href: string; label: string; icon: any; comingSoon?: boolean }[];

export function AdminSidebar({ onLogout, isOpen, onClose }: { onLogout: () => void; isOpen: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const { data: pendingCounts } = useQuery<{ pendingVendors: number; pendingActivities: number; pendingCoupons: number }>({
    queryKey: ['admin', 'notifications'],
    queryFn: () => api.get('/admin/notifications/counts').then(r => r.data),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  // Map sidebar hrefs to their pending count
  const badgeMap: Record<string, number> = {
    '/admin/vendors': pendingCounts?.pendingVendors ?? 0,
    '/admin/activities': pendingCounts?.pendingActivities ?? 0,
    '/admin/coupons': pendingCounts?.pendingCoupons ?? 0,
  };

  useEffect(() => setMounted(true), []);

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      {/*
        Class-order note: `ltr:-translate-x-full` has selector
        `[dir=ltr] .ltr\:-translate-x-full` (specificity 0,0,2,0) and out-
        weighs the @media-only `.md\:translate-x-0` (specificity 0,0,1,0)
        — so on desktop the sidebar would silently stay translated off-
        screen. Scoping the hide-rule with `max-md:` confines it below
        the md breakpoint; nothing fires above it, and the bare
        `md:translate-x-0` is the only matching rule on desktop.
      */}
      <aside className={`fixed inset-s-0 top-0 z-30 h-full w-64 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-e border-gray-200/80 dark:border-slate-800/80 flex flex-col transition-transform duration-300 ease-in-out md:translate-x-0 ${isOpen ? 'translate-x-0' : 'max-md:ltr:-translate-x-full max-md:rtl:translate-x-full'}`}>
      {/* Brand */}
      <div className="px-6 pt-8 pb-6 flex items-start justify-between">
        <div>
          <Link
            href="/admin/dashboard"
            onClick={onClose}
            className="text-xl font-bold tracking-tight bg-linear-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 bg-clip-text text-transparent block"
          >
            Jadwal Admin
          </Link>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Management Console</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="md:hidden p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-slate-300 dark:hover:bg-slate-800 transition-colors"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon, comingSoon }) => {
          if (comingSoon) {
            return (
              <div
                key={label}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-300 dark:text-slate-600 cursor-not-allowed"
              >
                <Icon className="h-[18px] w-[18px] shrink-0 text-gray-300 dark:text-slate-700" />
                <span>{label}</span>
                <span className="ms-auto text-[9px] font-semibold uppercase tracking-wider bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-slate-500 px-1.5 py-0.5 rounded">Soon</span>
              </div>
            );
          }
          const isActive = pathname === href || (href !== '/admin/dashboard' && pathname?.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-linear-to-r from-blue-500/10 to-indigo-500/10 dark:from-blue-500/15 dark:to-indigo-500/15 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800/60 hover:text-gray-900 dark:hover:text-slate-200'
              }`}
            >
              <Icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-slate-500'}`} />
              {label}
              {(badgeMap[href] ?? 0) > 0 && (
                <span className="ms-auto min-w-[20px] h-5 flex items-center justify-center bg-amber-500 text-white text-[10px] font-bold rounded-full px-1.5">
                  {badgeMap[href]}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom actions */}
      <div className="px-3 pb-6 space-y-1">
        {mounted && (
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium w-full transition-all duration-200 text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800/60 hover:text-gray-900 dark:hover:text-slate-200 cursor-pointer"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? (
              <Sun className="h-[18px] w-[18px] text-amber-400" />
            ) : (
              <Moon className="h-[18px] w-[18px] text-slate-500" />
            )}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        )}

        <button
          type="button"
          onClick={onLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium w-full transition-all duration-200 text-gray-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
        >
          <LogOut className="h-[18px] w-[18px]" />
          Sign Out
        </button>
      </div>
    </aside>
    </>
  );
}
