'use client';

/**
 * Locale-aware `<Link>` for PUBLIC routes. Derives the current language from the
 * URL (the `/ar` prefix is the source of truth post-migration) and prefixes
 * string `href`s so navigation stays within the active language:
 *   - On `/ar/explore`, `<LocaleLink href="/activity/x">` → `/ar/activity/x`.
 *   - On `/explore` (English), the same link stays `/activity/x`.
 *
 * Non-localizable targets (`/admin`, `/login`, external/hash/query-only) are
 * left untouched by `localePath`. Drop-in replacement for `next/link` on
 * public-facing navigation (navbar, footer, cards, public pages).
 */

import Link, { type LinkProps } from 'next/link';
import { usePathname } from 'next/navigation';
import { forwardRef } from 'react';
import { localePath, stripLocalePrefix } from '@/lib/locale-path';

type LocaleLinkProps = Omit<LinkProps, 'href'> & {
  href: string;
  children?: React.ReactNode;
  className?: string;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps>;

export const LocaleLink = forwardRef<HTMLAnchorElement, LocaleLinkProps>(
  function LocaleLink({ href, ...props }, ref) {
    const pathname = usePathname();
    const { lang } = stripLocalePrefix(pathname ?? '/');
    // Only rewrite app-relative paths ("/..."); leave external, hash, and
    // protocol/mailto/tel hrefs alone so the helper never corrupts them.
    const localized = href.startsWith('/') ? localePath(href, lang) : href;
    return <Link ref={ref} href={localized} {...props} />;
  },
);
