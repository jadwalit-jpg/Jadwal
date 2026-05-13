'use client';

/**
 * Minimal navbar — for the `/home-test` diagnostic route only.
 *
 * Deliberately stripped vs the production `<Navbar/>`: no transparent/scroll
 * variant (so no scroll `useEffect`), no notification bell, no user/avatar
 * dropdown, no auth-loading skeleton, no admin/vendor dashboard button, no
 * glass/`backdrop-blur`. Just a logo, three links, the theme toggle, and a
 * mobile hamburger with the links + the language toggle. ~1/5th the code of the
 * real navbar → much less to hydrate. Used to A/B against the full navbar on
 * mobile and see how much of `/home`'s hydration/INP cost is the navbar.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';
import { Sun, Moon, Menu, X, Globe } from 'lucide-react';

export function NavbarBasic() {
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const isAr = i18n.language === 'ar';
  const links = [
    { href: '/', label: t('nav.home') },
    { href: '/explore', label: t('nav.explore') },
    { href: '/offers', label: t('nav.offers') },
  ];
  const toggleLang = () => {
    i18n.changeLanguage(isAr ? 'en' : 'ar');
    router.refresh();
  };
  return (
    <header className="fixed top-0 inset-x-0 z-100 bg-white/95 dark:bg-slate-900/95 border-b border-sky-100 dark:border-slate-800 shadow-sm">
      <nav className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="text-lg sm:text-2xl font-bold tracking-tight bg-[linear-gradient(90deg,#F6B34B_0%,#F07D4C_18%,#E84D6E_38%,#8E58A3_58%,#2E9D93_78%,#3D98D1_100%)] bg-clip-text text-transparent"
        >
          Al Jadwal
        </Link>
        <div className="hidden md:flex items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="px-4 py-1.5 rounded-full text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
            className="p-2 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400"
          >
            <Sun className="hidden h-4 w-4 dark:block" aria-hidden="true" />
            <Moon className="block h-4 w-4 dark:hidden" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={open}
            aria-controls="navbar-basic-mobile-menu"
            className="md:hidden p-2 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>
      {open && (
        <div id="navbar-basic-mobile-menu" className="md:hidden border-t border-gray-100 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 px-3 py-2 space-y-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block px-4 py-3 rounded-xl text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-800 transition-colors"
            >
              {l.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => { toggleLang(); setOpen(false); }}
            className="flex w-full items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-800 transition-colors"
            aria-label={isAr ? 'Switch to English' : 'التبديل إلى العربية'}
          >
            <Globe className="h-4 w-4 text-gray-400 dark:text-slate-500" aria-hidden="true" />
            <span>{isAr ? 'English' : 'العربية'}</span>
          </button>
        </div>
      )}
    </header>
  );
}
