'use client';

/**
 * Navbar for `/home-test`.
 *
 * Same *features* as the full `<Navbar/>` (auth-aware login/avatar dropdown,
 * Become-a-Vendor link, desktop language toggle, theme toggle, mobile menu)
 * but a *lighter visual style*: no glass pill wrapping the desktop links, no
 * `backdrop-blur` on the header or the mobile menu, the same overlay-vs-scroll
 * pattern (transparent over the hero, opaque past it) so the navbar and hero
 * read as one piece. No notification bell — `/home-test` is a perf-test build
 * and the bell is a heavier subscription we don't need here.
 *
 * Mobile menu items each have a leading lucide icon (Home / Compass / Tag /
 * Store / Globe / LogIn / etc.) — mirrors `<Navbar/>`'s pattern.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/auth-context';
import api from '@/lib/api';
import {
  Sun, Moon, Menu, X, Globe,
  Home, Compass, Tag, Store,
  Bell, CalendarDays, Heart, User, LogOut, ChevronDown,
} from 'lucide-react';

export function NavbarBasic() {
  const router = useRouter();
  const { user, logout, loading: authLoading } = useAuth();
  // `resolvedTheme` (not `theme`) is the effective light/dark — `theme` can be
  // the literal `'system'`, so `theme === 'dark'` is false even when the page
  // renders dark. Same bug-fix as on the production `<Navbar/>`.
  const { setTheme, resolvedTheme } = useTheme();
  const { t, i18n } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  // Stash the body's prior `overflow` value when we lock the page scroll for
  // the mobile menu, so we can restore exactly that on close — not just `''`,
  // which would clobber any other overlay's lock that happened to be active.
  const prevBodyOverflowRef = useRef<string | null>(null);
  const isAr = i18n.language === 'ar';
  const isCustomer = user?.role === 'CUSTOMER';

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    // Go opaque only once you've scrolled (roughly) past the full-viewport hero
    // — so the navbar stays transparent over the hero (reads as one piece) and
    // turns into a solid bar past it. Init on mount in case we load mid-page.
    const onScroll = () => setScrolled(window.scrollY > window.innerHeight - 80);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close user dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Lock body scroll while the mobile menu is open — the menu is a fixed
  // overlay panel on top of the page; without this, scrolling the panel ends
  // up scrolling the page underneath. Restore the *previous* overflow value
  // on close (not just `''`) so we don't clobber any other component that
  // also locked the scroll.
  useEffect(() => {
    if (open) {
      if (prevBodyOverflowRef.current === null) {
        prevBodyOverflowRef.current = document.body.style.overflow;
      }
      document.body.style.overflow = 'hidden';
    } else if (prevBodyOverflowRef.current !== null) {
      document.body.style.overflow = prevBodyOverflowRef.current;
      prevBodyOverflowRef.current = null;
    }
    return () => {
      if (prevBodyOverflowRef.current !== null) {
        document.body.style.overflow = prevBodyOverflowRef.current;
        prevBodyOverflowRef.current = null;
      }
    };
  }, [open]);

  // Escape closes the mobile menu — overlay is modal-like, so a keyboard user
  // who can't reach the hamburger toggle needs a way out without a click.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const toggleLanguage = useCallback(() => {
    // Same pattern as `<Navbar/>` — flip the i18n singleton (re-translates all
    // useTranslation consumers), then `router.refresh()` so server-rendered
    // strings (the hero islands) re-render with the new lang cookie.
    i18n.changeLanguage(isAr ? 'en' : 'ar');
    router.refresh();
  }, [i18n, isAr, router]);

  // Unread-count for the Notifications row inside the mobile menu (customer
  // only). *Same `queryKey` as `<NotificationBell/>` uses on the production
  // navbar* (`['notifications', 'unread-count']`), so the cache is shared —
  // no duplicate polling between `/home`'s `<Navbar/>` and this menu.
  // Gated on `isCustomer` because admins/vendors don't see a Notifications row.
  const { data: unreadData } = useQuery<{ unreadCount: number }>({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get('/notifications/unread-count').then(r => r.data),
    enabled: isCustomer,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
  const unreadCount = unreadData?.unreadCount ?? 0;

  const links = [
    { href: '/', label: t('nav.home'), icon: Home },
    { href: '/explore', label: t('nav.explore'), icon: Compass },
    { href: '/offers', label: t('nav.offers'), icon: Tag },
  ];

  // Tone the inline link / icon-button colors to scroll state — same overlay
  // pattern as the full `<Navbar/>`, just without the glass pill wrappers.
  const linkCls = scrolled
    ? 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
    : 'text-white/85 hover:bg-white/15 hover:text-white';
  const iconBtnCls = scrolled
    ? 'border-gray-200 text-gray-500 hover:bg-gray-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
    : 'border-white/20 text-white/80 hover:bg-white/10';

  return (
    <>
      <header
        className={`fixed top-0 inset-x-0 z-100 transition-colors duration-300 ${
          scrolled
            ? 'bg-white/95 dark:bg-slate-900/95 border-b border-sky-100 dark:border-slate-800 shadow-sm'
            : 'bg-transparent border-b border-transparent'
        }`}
      >
        <nav className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4 gap-3">
        {/* Wordmark — switches `Al Jadwal` ↔ `الجدول` with the lang. Gated on
            `mounted` to avoid an SSR mismatch (the cookie may not match the
            client-side i18n state on first paint). */}
        <Link
          href="/"
          className="text-lg sm:text-2xl font-bold tracking-tight bg-[linear-gradient(90deg,#F6B34B_0%,#F07D4C_18%,#E84D6E_38%,#8E58A3_58%,#2E9D93_78%,#3D98D1_100%)] bg-clip-text text-transparent shrink-0"
        >
          {!mounted ? 'Al Jadwal' : isAr ? 'الجدول' : 'Al Jadwal'}
        </Link>

        {/* Desktop links — Home / Explore / Offers (+ Become a Vendor for
            non-customers). Auth-loading shows a skeleton row to avoid the
            flash of "Become a Vendor → empty" when the user is actually a
            CUSTOMER. */}
        {authLoading ? (
          <div className="hidden md:flex items-center gap-1">
            <div className={`h-7 w-14 rounded-full animate-pulse ${scrolled ? 'bg-gray-200/80 dark:bg-slate-700/60' : 'bg-white/15'}`} />
            <div className={`h-7 w-16 rounded-full animate-pulse ${scrolled ? 'bg-gray-200/80 dark:bg-slate-700/60' : 'bg-white/15'}`} />
            <div className={`h-7 w-16 rounded-full animate-pulse ${scrolled ? 'bg-gray-200/80 dark:bg-slate-700/60' : 'bg-white/15'}`} />
            <div className={`h-7 w-28 rounded-full animate-pulse ${scrolled ? 'bg-gray-200/80 dark:bg-slate-700/60' : 'bg-white/15'}`} />
          </div>
        ) : (
          <div className="hidden md:flex items-center gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${linkCls}`}
              >
                {l.label}
              </Link>
            ))}
            {!isCustomer && (
              <Link
                href="/register/vendor"
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${linkCls}`}
              >
                {t('nav.becomeVendor')}
              </Link>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Desktop language toggle — `EN` / `ع` button, same as `<Navbar/>`.
              On mobile this lives in the hamburger menu below (keeps the mobile
              header uncluttered). */}
          <button
            type="button"
            onClick={toggleLanguage}
            aria-label={!mounted ? 'Switch language' : isAr ? 'Switch to English' : 'التبديل إلى العربية'}
            title={!mounted ? '' : isAr ? 'English' : 'العربية'}
            className={`hidden md:flex items-center justify-center w-9 h-9 rounded-lg border transition-colors ${iconBtnCls}`}
          >
            <span className="text-xs font-bold leading-none">
              {!mounted ? '' : isAr ? 'EN' : 'ع'}
            </span>
          </button>

          {/* Theme toggle. Icon driven by `dark:` against `<html class>` so the
              right icon shows on first paint with no mounted gate; click gated
              on `mounted` so `resolvedTheme` is known before we flip. */}
          <button
            type="button"
            onClick={() => { if (mounted) setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'); }}
            aria-label="Toggle theme"
            className={`p-2 rounded-lg border transition-colors ${iconBtnCls}`}
          >
            <Sun className="hidden h-4 w-4 dark:block" aria-hidden="true" />
            <Moon className="block h-4 w-4 dark:hidden" aria-hidden="true" />
          </button>

          {/* Admin / Vendor dashboard button — desktop only. */}
          {user && (user.role === 'ADMIN' || user.role === 'VENDOR') && (
            <Link
              href={user.role === 'ADMIN' ? '/admin/dashboard' : `/vendor/${user.vendor?.slug ?? 'portal'}/dashboard`}
              className={`hidden md:inline-flex px-4 py-2 text-sm font-medium rounded-xl transition-colors border ${
                scrolled
                  ? 'bg-sky-600 hover:bg-sky-700 text-white border-sky-600 dark:bg-blue-600 dark:hover:bg-blue-700 dark:border-blue-600'
                  : 'bg-white/20 hover:bg-white/30 text-white border-white/20'
              }`}
            >
              {t('nav.dashboard')}
            </Link>
          )}

          {/* Customer avatar dropdown — desktop only. */}
          {user && user.role === 'CUSTOMER' && (
            <div ref={userMenuRef} className="relative hidden md:block">
              <button
                type="button"
                onClick={() => setUserMenuOpen((v) => !v)}
                aria-expanded={userMenuOpen}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-colors border ${
                  scrolled
                    ? 'bg-white border-gray-200 hover:bg-gray-50 dark:bg-slate-800 dark:border-slate-700 dark:hover:bg-slate-700'
                    : 'bg-white/10 border-white/20 hover:bg-white/20'
                }`}
              >
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  scrolled ? 'bg-sky-600 text-white dark:bg-blue-600' : 'bg-white/20 text-white'
                }`}>
                  {user.fullName?.charAt(0).toUpperCase() ?? 'U'}
                </span>
                <span className={`text-sm font-medium max-w-[100px] truncate ${
                  scrolled ? 'text-gray-800 dark:text-white' : 'text-white'
                }`}>
                  {user.fullName?.split(' ')[0]}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={`w-3.5 h-3.5 transition-transform ${userMenuOpen ? 'rotate-180' : ''} ${
                    scrolled ? 'text-gray-400 dark:text-slate-500' : 'text-white/60'
                  }`}
                />
              </button>
              {userMenuOpen && (
                <div
                  className="absolute inset-e-0 mt-2 w-52 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200/60 dark:border-slate-700/60 shadow-xl shadow-black/10 dark:shadow-black/30 overflow-hidden z-50"
                >
                  <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{user.fullName}</p>
                    <p className="text-xs text-gray-400 dark:text-slate-500 truncate">{user.email}</p>
                  </div>
                  <div className="py-1.5">
                    <Link
                      href="/bookings"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-white transition-colors"
                    >
                      <CalendarDays aria-hidden="true" className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                      {t('nav.myBookings')}
                    </Link>
                    <Link
                      href="/likes"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-white transition-colors"
                    >
                      <Heart aria-hidden="true" className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                      {t('nav.likedActivities')}
                    </Link>
                    <Link
                      href="/profile"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-white transition-colors"
                    >
                      <User aria-hidden="true" className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                      {t('nav.profile')}
                    </Link>
                  </div>
                  <div className="border-t border-gray-100 dark:border-slate-800 py-1.5">
                    <button
                      type="button"
                      onClick={() => { setUserMenuOpen(false); logout(); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                    >
                      <LogOut aria-hidden="true" className="w-4 h-4" />
                      {t('nav.logout')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Auth-loading skeleton — desktop only. Reserves the width of
              Login + Signup combined so the row doesn't jump when auth
              resolves. Mobile has no auth-related elements on the bar (Login
              / Logout live inside the hamburger menu), so no mobile skeleton
              is needed here. */}
          {authLoading && (
            <div className={`hidden md:block w-32 h-9 rounded-xl animate-pulse ${
              scrolled ? 'bg-gray-100 dark:bg-slate-700' : 'bg-white/10'
            }`} />
          )}

          {/* Logged-out — Login + Signup. Desktop only on the bar; on mobile
              the user opens the hamburger menu to log in (see the menu below).
              Logout when logged-in is also menu-only on mobile. */}
          {!authLoading && !user && (
            <>
              <Link
                href="/login"
                className={`hidden md:inline-flex px-4 py-2 text-sm font-medium transition-colors ${
                  scrolled
                    ? 'text-gray-600 hover:text-sky-600 dark:text-slate-400 dark:hover:text-white'
                    : 'text-white/85 hover:text-white'
                }`}
              >
                {t('nav.login')}
              </Link>
              <Link
                href="/register"
                className={`hidden md:inline-flex px-4 py-2 text-sm font-semibold rounded-xl transition-colors shadow-md ${
                  scrolled
                    ? 'bg-sky-600 hover:bg-sky-700 text-white dark:bg-blue-600 dark:hover:bg-blue-700'
                    : 'bg-white text-sky-700 hover:bg-white/90'
                }`}
              >
                {t('nav.signup')}
              </Link>
            </>
          )}

          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={open}
            aria-controls="navbar-basic-mobile-menu"
            className={`md:hidden p-2 rounded-lg border transition-colors ${iconBtnCls}`}
          >
            {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
        </nav>
      </header>

      {/* Mobile menu — floating overlay panel, same visual pattern as the
          production `<Navbar/>` (so `/home-test` and `/explore` feel identical
          when you tap the hamburger). Backdrop dimming + slide-down animation,
          panel positioned `top-[72px] inset-x-4` so it floats just below the
          header. `bg-white/95` solid-translucent — no `backdrop-blur`, which
          is mobile-expensive (the dark backdrop is plenty of separation). */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-99 bg-black/40 md:hidden animate-[fade-in_0.2s_ease-out] motion-reduce:animate-none"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed top-[72px] inset-x-4 z-101 md:hidden animate-[slide-down-in_0.25s_ease-out] motion-reduce:animate-none">
            {/* The overlay is modal-like (locks body scroll, closes on
                backdrop / Escape), so mark it as such for AT users. Labelled
                with `aria-label` rather than `aria-labelledby` since the menu
                has no visible title element — `<Menu>` is the common pattern. */}
            <div
              id="navbar-basic-mobile-menu"
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              className="rounded-2xl bg-white/95 dark:bg-slate-900/95 border border-gray-200/50 dark:border-slate-700/50 shadow-2xl shadow-black/10 dark:shadow-black/30 overflow-hidden"
            >
              <div className="p-3 space-y-1">
                {links.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-white transition-colors"
                  >
                    <l.icon aria-hidden="true" className="h-4 w-4 text-gray-400 dark:text-slate-500" />
                    {l.label}
                  </Link>
                ))}

                {/* Become a Vendor — same `!isCustomer` gate as desktop. */}
                {!authLoading && !isCustomer && (
                  <Link
                    href="/register/vendor"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-white transition-colors"
                  >
                    <Store aria-hidden="true" className="h-4 w-4 text-gray-400 dark:text-slate-500" />
                    {t('nav.becomeVendor')}
                  </Link>
                )}

                {/* Language toggle */}
                <button
                  type="button"
                  onClick={() => { toggleLanguage(); setOpen(false); }}
                  aria-label={!mounted ? 'Switch language' : isAr ? 'Switch to English' : 'التبديل إلى العربية'}
                  className="flex w-full items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-white transition-colors"
                >
                  <Globe aria-hidden="true" className="h-4 w-4 text-gray-400 dark:text-slate-500" />
                  <span>{!mounted ? '' : isAr ? 'English' : 'العربية'}</span>
                </button>
              </div>

              {/* Logged-out — single Login filled CTA (user feedback: "remove
                  the signup and instead of it put login"). Sign Up is dropped
                  on mobile; users who want to register can do so from the
                  login page. */}
              {!authLoading && !user && (
                <div className="p-3 pt-0">
                  <div className="border-t border-gray-100 dark:border-slate-800 pt-3">
                    <Link
                      href="/login"
                      onClick={() => setOpen(false)}
                      className="block w-full py-3 text-center bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-xl transition-colors"
                    >
                      {t('nav.login')}
                    </Link>
                  </div>
                </div>
              )}

              {/* Admin / Vendor — Dashboard CTA + Logout. */}
              {user && (user.role === 'ADMIN' || user.role === 'VENDOR') && (
                <div className="p-3 pt-0">
                  <div className="border-t border-gray-100 dark:border-slate-800 pt-3 space-y-1">
                    <Link
                      href={user.role === 'ADMIN' ? '/admin/dashboard' : `/vendor/${user.vendor?.slug ?? 'portal'}/dashboard`}
                      onClick={() => setOpen(false)}
                      className="block w-full py-3 text-center bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-xl transition-colors"
                    >
                      {t('nav.dashboard')}
                    </Link>
                    <button
                      type="button"
                      onClick={() => { setOpen(false); logout(); }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                    >
                      <LogOut aria-hidden="true" className="h-4 w-4" />
                      {t('nav.logout')}
                    </button>
                  </div>
                </div>
              )}

              {/* Customer — name / email header + notifications / bookings / likes / profile / logout. */}
              {user && user.role === 'CUSTOMER' && (
                <div className="p-3 pt-0">
                  <div className="border-t border-gray-100 dark:border-slate-800 pt-3 space-y-1">
                    <div className="px-3 py-2 mb-1">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{user.fullName}</p>
                      <p className="text-xs text-gray-400 dark:text-slate-500 truncate">{user.email}</p>
                    </div>
                    {/* Notifications row — replaces the missing bar bell on
                        `/home-test`. Links to the full-page list (`/notifications`)
                        rather than embedding the bell's popover here (the popover
                        is desktop-bar-anchored — nesting it inside a fixed mobile
                        overlay creates positioning fights). Unread badge reads
                        from the shared `useQuery` above. */}
                    <Link
                      href="/notifications"
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-white transition-all"
                    >
                      <span className="flex items-center gap-3">
                        <Bell aria-hidden="true" className="h-4 w-4 text-gray-400 dark:text-slate-500" />
                        {t('notifications.title')}
                      </span>
                      {unreadCount > 0 && (
                        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      )}
                    </Link>
                    <Link
                      href="/bookings"
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-white transition-all"
                    >
                      <CalendarDays aria-hidden="true" className="h-4 w-4 text-gray-400 dark:text-slate-500" />
                      {t('nav.myBookings')}
                    </Link>
                    <Link
                      href="/likes"
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-white transition-all"
                    >
                      <Heart aria-hidden="true" className="h-4 w-4 text-gray-400 dark:text-slate-500" />
                      {t('nav.likedActivities')}
                    </Link>
                    <Link
                      href="/profile"
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-white transition-all"
                    >
                      <User aria-hidden="true" className="h-4 w-4 text-gray-400 dark:text-slate-500" />
                      {t('nav.profile')}
                    </Link>
                    <button
                      type="button"
                      onClick={() => { setOpen(false); logout(); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
                    >
                      <LogOut aria-hidden="true" className="h-4 w-4" />
                      {t('nav.logout')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
