'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useAuth } from '@/context/auth-context';
import { useTranslation } from 'react-i18next';
import { Sun, Moon, Menu, X, Home, Compass, Tag, Store, CalendarDays, Heart, User, LogOut, ChevronDown, Globe } from 'lucide-react';
import { useEffect, useRef, useState, useCallback } from 'react';
import NotificationBell from '@/components/notification-bell';

// Small enter-only animations (CSS, not framer-motion — this component is on
// every page; pulling ~170 KB of animation engine into the shared chunk for a
// dropdown fade isn't worth it). Exit is instant — standard for menus, and CSS
// can't cheaply do exit animations without re-introducing JS state. Keyframes
// (`dropdown-in`, `fade-in`, `slide-down-in`) live in globals.css.
//
// Not wrapped in React.memo: its re-renders are driven by context (useAuth /
// useTheme / i18n), not props — memo doesn't help those, and the re-render
// itself is cheap (the theme-toggle lag was the CSS transitions, fixed by
// `disableTransitionOnChange` + `transition-colors`, not this component
// re-rendering).
export default function Navbar({ variant = 'transparent' }: { variant?: 'transparent' | 'solid' }) {
  const router = useRouter();
  const { user, logout, loading: authLoading } = useAuth();
  // `resolvedTheme` (not `theme`) is the *effective* light/dark. `theme` can be
  // the literal `'system'` (the default), so `theme === 'dark'` is false even
  // when the page is rendered dark — using `theme` here was a bug: system-theme
  // users got the wrong toggle icon and their first click did nothing visible
  // (it set `theme` to `'dark'` while the page was already dark).
  const { setTheme, resolvedTheme } = useTheme();
  const { t, i18n } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const isAr = i18n.language === 'ar';

  // changeLanguage updates the i18n singleton (so all useTranslation
  // consumers re-render) AND writes the cookie. router.refresh() then
  // re-fetches the RSC payload for the current route — this is required
  // because server components like the home `/` hero render translated
  // strings from the cookie at request time; without a refresh those
  // strings stay frozen at whatever language the page was first loaded
  // with. Client components update from i18n state immediately.
  const toggleLanguage = useCallback(() => {
    i18n.changeLanguage(isAr ? 'en' : 'ar');
    router.refresh();
  }, [i18n, isAr, router]);

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

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close mobile menu on route change / resize
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const isOpaque = variant === 'solid' || scrolled;

  const isCustomer = user?.role === 'CUSTOMER';

  const mobileLinks = [
    { href: '/', label: t('nav.home'), icon: Home },
    { href: '/explore', label: t('nav.explore'), icon: Compass },
    { href: '/offers', label: t('nav.offers'), icon: Tag },
    ...(!authLoading && !isCustomer ? [{ href: '/register/vendor', label: t('nav.becomeVendor'), icon: Store }] : []),
  ];

  return (
    <>
      {/* `md:backdrop-blur-xl` not plain `backdrop-blur-xl`: on a phone a *fixed*
          blurred bar re-rasterizes everything behind it on every scroll frame —
          expensive. On mobile it's a solid-translucent bar instead (bumped to
          /90 so it stays readable without the blur); the frosted look stays on
          desktop. (Mirrors globals.css's `.glass-surface` mobile carve-out.) */}
      <header className={`fixed top-0 inset-x-0 z-100 transition-colors duration-300 ${isOpaque ? 'bg-white/90 dark:bg-slate-900/90 md:backdrop-blur-xl border-b border-sky-100 dark:border-slate-800 shadow-sm' : 'bg-transparent border-b border-transparent'}`}>
        <nav className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-1.5 sm:gap-2">
            {/* Wordmark only — logo image dropped per user request. Rainbow
                gradient mirrors the six tile colors of the logo (gold →
                coral → magenta → purple → teal → sky) painted onto the
                glyphs themselves via bg-clip-text. text-lg/sm:text-xl on
                mobile, scales to text-xl/sm:text-2xl from sm: up. */}
            <span className="text-lg sm:text-2xl font-bold tracking-tight bg-[linear-gradient(90deg,#F6B34B_0%,#F07D4C_18%,#E84D6E_38%,#8E58A3_58%,#2E9D93_78%,#3D98D1_100%)] bg-clip-text text-transparent">
              Al Jadwal
            </span>
            <span className="text-lg sm:text-2xl font-bold tracking-tight bg-[linear-gradient(90deg,#F6B34B_0%,#F07D4C_18%,#E84D6E_38%,#8E58A3_58%,#2E9D93_78%,#3D98D1_100%)] bg-clip-text text-transparent">
              الجدول
            </span>
          </Link>

          {/* Glass pill nav links — desktop only */}
          {authLoading ? (
            <div className={`hidden md:flex items-center gap-2 rounded-full px-3 py-2 transition-colors duration-300 ${isOpaque ? 'bg-gray-100/80 dark:bg-slate-800/80 border border-gray-200/50 dark:border-slate-700/50' : 'bg-white/10 border border-white/20'}`}>
              <div className={`h-7 w-14 rounded-full animate-pulse ${isOpaque ? 'bg-gray-200/80 dark:bg-slate-700/60' : 'bg-white/15'}`} />
              <div className={`h-7 w-16 rounded-full animate-pulse ${isOpaque ? 'bg-gray-200/80 dark:bg-slate-700/60' : 'bg-white/15'}`} />
              <div className={`h-7 w-28 rounded-full animate-pulse ${isOpaque ? 'bg-gray-200/80 dark:bg-slate-700/60' : 'bg-white/15'}`} />
              <div className={`h-7 w-28 rounded-full animate-pulse ${isOpaque ? 'bg-gray-200/80 dark:bg-slate-700/60' : 'bg-white/15'}`} />
            </div>
          ) : (
            <div className={`hidden md:flex items-center gap-1 rounded-full px-1.5 py-1.5 transition-colors duration-300 ${isOpaque ? 'bg-gray-100/80 dark:bg-slate-800/80 border border-gray-200/50 dark:border-slate-700/50' : 'bg-white/10 backdrop-blur-md border border-white/20 shadow-lg shadow-black/5'}`}>
              <Link href="/" className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${isOpaque ? 'text-gray-700 hover:bg-white hover:shadow-sm dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white' : 'text-white/90 hover:bg-white/15 hover:text-white'}`}>{t('nav.home')}</Link>
              <Link href="/explore" className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${isOpaque ? 'text-gray-500 hover:bg-white hover:text-gray-900 hover:shadow-sm dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white' : 'text-white/70 hover:bg-white/15 hover:text-white'}`}>{t('nav.explore')}</Link>
              <Link href="/offers" className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap ${isOpaque ? 'text-gray-500 hover:bg-white hover:text-gray-900 hover:shadow-sm dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white' : 'text-white/70 hover:bg-white/15 hover:text-white'}`}>{t('nav.offers')}</Link>
              {!isCustomer && (
                <Link href="/register/vendor" className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap ${isOpaque ? 'text-gray-500 hover:bg-white hover:text-gray-900 hover:shadow-sm dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white' : 'text-white/70 hover:bg-white/15 hover:text-white'}`}>{t('nav.becomeVendor')}</Link>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            {/* Language toggle — desktop only (`md:+`); on mobile it lives in the
                hamburger menu below (keeps the mobile header uncluttered). The
                inner span text is gated on `mounted` to avoid an SSR mismatch. */}
            <button
              onClick={toggleLanguage}
              className={`hidden md:block p-2 rounded-lg border transition-all ${isOpaque ? 'text-gray-400 hover:text-sky-600 border-gray-200 hover:border-sky-300 dark:text-slate-500 dark:hover:text-white dark:border-slate-700 dark:hover:border-slate-500' : 'text-white/60 hover:text-white border-white/20 hover:border-white/40'}`}
              aria-label={!mounted ? 'Switch language' : isAr ? 'Switch to English' : 'التبديل إلى العربية'}
              title={!mounted ? '' : isAr ? 'English' : 'العربية'}
            >
              <span className="text-xs font-bold leading-none block w-4 h-4 flex items-center justify-center">
                {!mounted ? <span className="w-4 h-4 block" /> : isAr ? 'EN' : 'ع'}
              </span>
            </button>

            {/* Theme toggle. Icon is CSS-driven (`dark:` against `<html class>`,
                which next-themes sets pre-hydration) so the correct icon shows
                on first paint with no `mounted` gate, and it's right even on
                `system` theme. The click is gated on `mounted` so `resolvedTheme`
                is known before we flip. */}
            <button
              onClick={() => { if (mounted) setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'); }}
              className={`p-2 rounded-lg border transition-all ${isOpaque ? 'text-gray-400 hover:text-sky-600 border-gray-200 hover:border-sky-300 dark:text-slate-500 dark:hover:text-white dark:border-slate-700 dark:hover:border-slate-500' : 'text-white/60 hover:text-white border-white/20 hover:border-white/40'}`}
              aria-label="Toggle theme"
            >
              <Sun className="hidden h-4 w-4 dark:block" aria-hidden="true" />
              <Moon className="block h-4 w-4 dark:hidden" aria-hidden="true" />
            </button>

            {/* Admin / Vendor — simple Dashboard button */}
            {user && (user.role === 'ADMIN' || user.role === 'VENDOR') && (
              <Link
                href={user.role === 'ADMIN' ? '/admin/dashboard' : `/vendor/${user.vendor?.slug ?? 'portal'}/dashboard`}
                className={`hidden sm:inline-flex px-4 py-2 text-sm font-medium rounded-xl transition-all border ${isOpaque ? 'bg-sky-600 hover:bg-sky-700 text-white border-sky-600 dark:bg-blue-600 dark:hover:bg-blue-700 dark:border-blue-600' : 'bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white border-white/20'}`}
              >
                Dashboard
              </Link>
            )}

            {/* Notification bell — customer only (admin/vendor have it in their sidebar) */}
            {user && user.role === 'CUSTOMER' && <NotificationBell />}

            {/* Customer — avatar + dropdown */}
            {user && user.role === 'CUSTOMER' && (
              <div ref={userMenuRef} className="relative hidden sm:block">
                <button
                  onClick={() => setUserMenuOpen(v => !v)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all border ${isOpaque ? 'bg-white/80 hover:bg-white border-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:border-slate-700' : 'bg-white/10 hover:bg-white/20 border-white/20'}`}
                >
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${isOpaque ? 'bg-sky-600 text-white dark:bg-blue-600' : 'bg-white/20 text-white'}`}>
                    {user.fullName?.charAt(0).toUpperCase() ?? 'U'}
                  </div>
                  <span className={`text-sm font-medium max-w-[100px] truncate ${isOpaque ? 'text-gray-800 dark:text-white' : 'text-white'}`}>
                    {user.fullName?.split(' ')[0]}
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${userMenuOpen ? 'rotate-180' : ''} ${isOpaque ? 'text-gray-400 dark:text-slate-500' : 'text-white/60'}`} />
                </button>

                {userMenuOpen && (
                    <div
                      className="absolute inset-e-0 mt-2 w-48 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200/60 dark:border-slate-700/60 shadow-xl shadow-black/10 dark:shadow-black/30 overflow-hidden z-50 animate-[dropdown-in_0.15s_ease-out] motion-reduce:animate-none"
                    >
                      {/* User info */}
                      <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{user.fullName}</p>
                        <p className="text-xs text-gray-400 dark:text-slate-500 truncate">{user.email}</p>
                      </div>
                      {/* Links */}
                      <div className="py-1.5">
                        <Link
                          href="/bookings"
                          onClick={() => setUserMenuOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-white transition-colors"
                        >
                          <CalendarDays className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                          {t('nav.myBookings')}
                        </Link>
                        <Link
                          href="/likes"
                          onClick={() => setUserMenuOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-white transition-colors"
                        >
                          <Heart className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                          {t('nav.likedActivities')}
                        </Link>
                        <Link
                          href="/profile"
                          onClick={() => setUserMenuOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-white transition-colors"
                        >
                          <User className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                          {t('nav.profile')}
                        </Link>
                      </div>
                      {/* Logout */}
                      <div className="border-t border-gray-100 dark:border-slate-800 py-1.5">
                        <button
                          onClick={() => { setUserMenuOpen(false); logout(); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                        >
                          <LogOut className="w-4 h-4" />
                          {t('nav.logout')}
                        </button>
                      </div>
                    </div>
                  )}
              </div>
            )}

            {/* Auth loading skeleton — prevents flash of login buttons */}
            {authLoading && (
              <div className={`hidden sm:block w-28 h-8 rounded-xl animate-pulse ${isOpaque ? 'bg-gray-100 dark:bg-slate-700' : 'bg-white/10'}`} />
            )}

            {/* Not logged in — only render once auth check is complete */}
            {!authLoading && !user && (
              <>
                <Link href="/login" className={`px-4 py-2 text-sm font-medium transition-colors ${isOpaque ? 'text-gray-500 hover:text-sky-600 dark:text-slate-400 dark:hover:text-white' : 'text-white/80 hover:text-white'}`}>
                  {t('nav.login')}
                </Link>
                <Link href="/register" className={`hidden md:inline-flex px-4 py-2 text-sm font-semibold rounded-xl transition-all shadow-lg ${isOpaque ? 'bg-sky-600 hover:bg-sky-700 text-white shadow-sky-200/30 dark:bg-blue-600 dark:hover:bg-blue-700 dark:shadow-none' : 'bg-white text-sky-700 hover:bg-white/90 shadow-black/10'}`}>
                  {t('nav.signup')}
                </Link>
              </>
            )}

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className={`md:hidden p-2 rounded-lg border transition-all ${isOpaque ? 'text-gray-500 border-gray-200 hover:bg-gray-50 dark:text-slate-400 dark:border-slate-700 dark:hover:bg-slate-800' : 'text-white/70 border-white/20 hover:bg-white/10'}`}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </nav>
      </header>

      {/* Mobile menu overlay */}
      {mobileOpen && (
          <>
            {/* Backdrop — no `backdrop-blur` (a full-screen blur of the page
                behind a dark overlay is pricey on a phone GPU; the bg-black/40
                dimming alone is enough). */}
            <div
              className="fixed inset-0 z-99 bg-black/40 md:hidden animate-[fade-in_0.2s_ease-out] motion-reduce:animate-none"
              onClick={() => setMobileOpen(false)}
            />

            {/* Menu panel — solid-translucent (bumped to /95), no `backdrop-blur`
                (this panel is `md:hidden`, i.e. mobile-only, and sits over the
                dark backdrop above, so it's plenty opaque without the blur). */}
            <div className="fixed top-[72px] inset-x-4 z-101 md:hidden animate-[slide-down-in_0.25s_ease-out] motion-reduce:animate-none">
              <div className="rounded-2xl bg-white/95 dark:bg-slate-900/95 border border-gray-200/50 dark:border-slate-700/50 shadow-2xl shadow-black/10 dark:shadow-black/30 overflow-hidden">
                <div className="p-3 space-y-1">
                  {mobileLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-white transition-colors"
                    >
                      <link.icon className="h-4 w-4 text-gray-400 dark:text-slate-500" />
                      {link.label}
                    </Link>
                  ))}
                  {/* Language toggle — lives here on mobile (the header copy is `md:+` only). */}
                  <button
                    type="button"
                    onClick={() => { toggleLanguage(); setMobileOpen(false); }}
                    className="flex w-full items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-white transition-colors"
                    aria-label={!mounted ? 'Switch language' : isAr ? 'Switch to English' : 'التبديل إلى العربية'}
                  >
                    <Globe className="h-4 w-4 text-gray-400 dark:text-slate-500" aria-hidden="true" />
                    <span>{!mounted ? ' ' : isAr ? 'English' : 'العربية'}</span>
                  </button>
                </div>

                {/* Sign Up in mobile menu */}
                {!authLoading && !user && (
                  <div className="p-3 pt-0">
                    <div className="border-t border-gray-100 dark:border-slate-800 pt-3">
                      <Link
                        href="/register"
                        onClick={() => setMobileOpen(false)}
                        className="block w-full py-3 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-xl text-center transition-all"
                      >
                        {t('nav.signup')}
                      </Link>
                    </div>
                  </div>
                )}

                {user && (user.role === 'ADMIN' || user.role === 'VENDOR') && (
                  <div className="p-3 pt-0">
                    <div className="border-t border-gray-100 dark:border-slate-800 pt-3">
                      <Link
                        href={user.role === 'ADMIN' ? '/admin/dashboard' : `/vendor/${user.vendor?.slug ?? 'portal'}/dashboard`}
                        onClick={() => setMobileOpen(false)}
                        className="block w-full py-3 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-xl text-center transition-all"
                      >
                        Dashboard
                      </Link>
                    </div>
                  </div>
                )}

                {user && user.role === 'CUSTOMER' && (
                  <div className="p-3 pt-0">
                    <div className="border-t border-gray-100 dark:border-slate-800 pt-3 space-y-1">
                      <div className="px-3 py-2 mb-1">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{user.fullName}</p>
                        <p className="text-xs text-gray-400 dark:text-slate-500 truncate">{user.email}</p>
                      </div>
                      <Link
                        href="/bookings"
                        onClick={() => setMobileOpen(false)}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-white transition-all"
                      >
                        <CalendarDays className="h-4 w-4 text-gray-400 dark:text-slate-500" />
                        {t('nav.myBookings')}
                      </Link>
                      <Link
                        href="/likes"
                        onClick={() => setMobileOpen(false)}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-white transition-all"
                      >
                        <Heart className="h-4 w-4 text-gray-400 dark:text-slate-500" />
                        {t('nav.likedActivities')}
                      </Link>
                      <Link
                        href="/profile"
                        onClick={() => setMobileOpen(false)}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-white transition-all"
                      >
                        <User className="h-4 w-4 text-gray-400 dark:text-slate-500" />
                        {t('nav.profile')}
                      </Link>
                      <button
                        onClick={() => { setMobileOpen(false); logout(); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
                      >
                        <LogOut className="h-4 w-4" />
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
