'use client';

import Link from 'next/link';
import { usePathname, useParams, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useCallback } from 'react';

import { useAuth } from '@/context/auth-context';
import api from '@/lib/api';
import NotificationBell from '@/components/notification-bell';
import {
  LayoutDashboard,
  CalendarRange,
  BookOpen,
  Wallet,
  MessageSquare,
  Settings,
  BarChart3,
  LogOut,
  Sun,
  Moon,
  Tag,
  Undo2,
  Languages,
} from 'lucide-react';

// Label is a translation key suffix resolved via `t('vendor.nav.<labelKey>')`
// so sidebar entries flip language alongside every other piece of chrome.
const navItems = [
  { path: 'dashboard',        labelKey: 'dashboard',       icon: LayoutDashboard },
  { path: 'activities',       labelKey: 'activities',      icon: CalendarRange },
  { path: 'bookings',         labelKey: 'bookings',        icon: BookOpen },
  { path: 'refund-requests',  labelKey: 'refundRequests',  icon: Undo2 },
  { path: 'coupons',          labelKey: 'coupons',         icon: Tag },
  { path: 'earnings',         labelKey: 'earnings',        icon: Wallet },
  { path: 'analytics',        labelKey: 'analytics',       icon: BarChart3 },
  { path: 'reviews',          labelKey: 'reviews',         icon: MessageSquare },
  { path: 'settings',         labelKey: 'settings',        icon: Settings },
] as const;

export function VendorSidebar() {
  const pathname = usePathname();
  const params = useParams();
  const slug = params.slug as string;
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { logout } = useAuth();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  // router.refresh() re-fetches the RSC payload so any server-rendered
  // translated strings update with the new cookie value. Client-side
  // i18n consumers update synchronously from the i18n singleton.
  const toggleLanguage = useCallback(() => {
    i18n.changeLanguage(isAr ? 'en' : 'ar');
    router.refresh();
  }, [i18n, isAr, router]);

  useEffect(() => setMounted(true), []);

  // Pending refund request count — shown as a red badge next to the nav link
  // so vendor knows there's work waiting. Refetched every 30s in the background.
  const { data: refundRequests } = useQuery<unknown[]>({
    queryKey: ['vendor', 'refund-requests-count'],
    queryFn: async () => {
      const { data } = await api.get('/vendor/refund-requests');
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });
  const pendingRefundCount = refundRequests?.length ?? 0;

  const handleLogout = async () => {
    await logout();
  };

  const base = `/vendor/${slug}`;

  return (
    <aside className="fixed inset-s-0 top-0 z-20 h-full w-64 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-e border-gray-200/80 dark:border-slate-800/80 flex flex-col">
      {/* Brand */}
      <div className="px-6 pt-8 pb-6">
        <Link
          href={`${base}/dashboard`}
          className="text-xl font-bold tracking-tight bg-linear-to-r from-teal-600 to-emerald-600 dark:from-teal-400 dark:to-emerald-400 bg-clip-text text-transparent block"
        >
          {t('vendor.portalBrand')}
        </Link>
        <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">{t('vendor.portalTitle')}</p>
        <div className="mt-3">
          <NotificationBell align="start" />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
        {navItems.map(({ path, labelKey, icon: Icon }) => {
          const href = `${base}/${path}`;
          const isActive = pathname === href || (path !== 'dashboard' && pathname?.startsWith(href));
          const showBadge = path === 'refund-requests' && pendingRefundCount > 0;
          return (
            <Link
              key={path}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                isActive
                  ? 'bg-linear-to-r from-teal-500/10 to-emerald-500/10 dark:from-teal-500/15 dark:to-emerald-500/15 text-teal-600 dark:text-teal-400 shadow-sm'
                  : 'text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800/60 hover:text-gray-900 dark:hover:text-slate-200'
              }`}
            >
              <Icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-teal-600 dark:text-teal-400' : 'text-gray-400 dark:text-slate-500'}`} />
              <span className="flex-1">{t(`vendor.nav.${labelKey}`)}</span>
              {showBadge && (
                <span className="inline-flex min-w-[20px] h-5 items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1.5">
                  {pendingRefundCount > 99 ? '99+' : pendingRefundCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom actions */}
      <div className="px-3 pb-6 space-y-1">
        <button
          type="button"
          onClick={toggleLanguage}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold w-full transition-all duration-200 text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800/60 hover:text-gray-900 dark:hover:text-slate-200 cursor-pointer"
          aria-label={isAr ? 'Switch to English' : 'التبديل إلى العربية'}
        >
          <Languages className="h-[18px] w-[18px] shrink-0" />
          <span className="flex-1 text-start">{isAr ? 'English' : 'العربية'}</span>
        </button>
        {mounted && (
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold w-full transition-all duration-200 text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800/60 hover:text-gray-900 dark:hover:text-slate-200 cursor-pointer"
            aria-label={t('vendor.sidebar.toggleTheme')}
          >
            {theme === 'dark' ? <Sun className="h-[18px] w-[18px] text-amber-400" /> : <Moon className="h-[18px] w-[18px] text-slate-500" />}
            {theme === 'dark' ? t('vendor.sidebar.lightMode') : t('vendor.sidebar.darkMode')}
          </button>
        )}
        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold w-full transition-all duration-200 text-gray-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
        >
          <LogOut className="h-[18px] w-[18px]" />
          {t('vendor.sidebar.signOut')}
        </button>
      </div>
    </aside>
  );
}
