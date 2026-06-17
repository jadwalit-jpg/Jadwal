'use client';

import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useCallback } from 'react';

import { useAuth } from '@/context/auth-context';
import { useLangSwitch } from '@/context/i18n-provider';
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
  Menu,
  X,
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const { logout } = useAuth();
  const { switchLanguage } = useLangSwitch();
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  // Delegate to the shared switcher (i18n-provider): flips the language and
  // shows the blur + spinner mask while the RSC refresh settles.
  const toggleLanguage = useCallback(() => {
    switchLanguage(isAr ? 'en' : 'ar');
  }, [switchLanguage, isAr]);

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
    <>
      {/* Mobile hamburger — fixed top-start, only visible when sidebar is closed on mobile */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className={`fixed top-4 start-4 z-40 md:hidden p-2 rounded-xl bg-white/90 dark:bg-slate-900/90 backdrop-blur border border-gray-200/80 dark:border-slate-800/80 text-gray-500 dark:text-slate-400 shadow-sm transition-opacity duration-200 ${mobileOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
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
      <aside className={`fixed inset-s-0 top-0 z-30 h-full w-64 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-e border-gray-200/80 dark:border-slate-800/80 flex flex-col transition-transform duration-300 ease-in-out md:translate-x-0 ${mobileOpen ? 'translate-x-0' : 'max-md:ltr:-translate-x-full max-md:rtl:translate-x-full'}`}>
      {/* Brand */}
      <div className="px-6 pt-8 pb-6 flex items-start justify-between">
        <div>
          <Link
            href={`${base}/dashboard`}
            onClick={() => setMobileOpen(false)}
            className="text-xl font-bold tracking-tight bg-linear-to-r from-teal-600 to-emerald-600 dark:from-teal-400 dark:to-emerald-400 bg-clip-text text-transparent block"
          >
            {t('vendor.portalBrand')}
          </Link>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">{t('vendor.portalTitle')}</p>
          <div className="mt-3">
            <NotificationBell align="start" />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="md:hidden p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-slate-300 dark:hover:bg-slate-800 transition-colors"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto scrollbar-slim">
        {navItems.map(({ path, labelKey, icon: Icon }) => {
          const href = `${base}/${path}`;
          const isActive = pathname === href || (path !== 'dashboard' && pathname?.startsWith(href));
          const showBadge = path === 'refund-requests' && pendingRefundCount > 0;
          return (
            <Link
              key={path}
              href={href}
              onClick={() => setMobileOpen(false)}
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
    </>
  );
}
