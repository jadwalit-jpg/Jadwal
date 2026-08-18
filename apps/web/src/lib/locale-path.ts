/**
 * URL ↔ language helpers for the bilingual `/ar/` routing (SEO P1#4).
 *
 * Model: English is UNPREFIXED (`/explore`), Arabic is prefixed (`/ar/explore`).
 * The language for a public page is derived from the URL, not the cookie.
 *
 * Server-safe: NO imports from react / react-i18next (this is imported by
 * middleware (Edge runtime) and the root layout (RSC)). Only depends on the
 * pure `lang-cookie` constants.
 */

import { type Lang } from './lang-cookie';

/**
 * Route prefixes that are NEVER localized with `/ar` — staff, auth, per-user,
 * and infra paths. They're `noindex` (zero SEO value) and stay cookie-driven UI.
 * Everything else (home, explore, offers, activity, the root landing slugs,
 * blog, about/contact/terms/privacy) IS localizable. A deny-list (not an
 * allow-list) so the dynamic root-level landing slugs are covered automatically.
 */
export const NON_LOCALIZED_PREFIXES = [
  '/admin', '/vendor',
  '/login', '/register', '/forgot-password', '/reset-password', '/verify-email',
  // Per-user / protected (kept in sync with middleware customerProtectedPaths):
  '/account', '/my-account', '/profile', '/bookings', '/cart', '/favorites', '/likes', '/notifications',
  '/payment', '/maintenance',
  '/api', '/_next',
] as const;

/** True when `path` is a public route eligible for an Arabic `/ar/` twin. */
export function isLocalizablePath(path: string): boolean {
  return !NON_LOCALIZED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/** True when `path` already carries the `/ar` locale prefix. */
export function hasArPrefix(path: string): boolean {
  return path === '/ar' || path.startsWith('/ar/');
}

/**
 * Split a request path into its locale + the underlying (unprefixed) path.
 *   `/ar/explore` → { lang: 'ar', path: '/explore' }
 *   `/ar`         → { lang: 'ar', path: '/' }
 *   `/explore`    → { lang: 'en', path: '/explore' }
 */
export function stripLocalePrefix(path: string): { lang: Lang; path: string } {
  if (path === '/ar') return { lang: 'ar', path: '/' };
  if (path.startsWith('/ar/')) return { lang: 'ar', path: path.slice(3) };
  return { lang: 'en', path };
}

/**
 * Produce the URL for `path` in `lang`. English → unchanged. Arabic → `/ar`-
 * prefixed IF the path is localizable and not already prefixed. Non-public
 * paths (admin/auth/…) are returned unchanged even in Arabic — they have no
 * `/ar` twin. `path` MUST be an app-relative path beginning with `/`.
 */
export function localePath(path: string, lang: Lang): string {
  if (lang !== 'ar') return path;
  if (hasArPrefix(path) || !isLocalizablePath(path)) return path;
  return path === '/' ? '/ar' : `/ar${path}`;
}

/**
 * Build the `metadata.alternates` block for a public page: a SELF-referential
 * canonical (so `/foo` and `/ar/foo` are each their own canonical, not dupes of
 * one another) plus `hreflang` links to both language variants + `x-default`
 * (English). `basePath` is the English (unprefixed) path, e.g. '/explore' or
 * `/activity/${slug}`. Pass the page's resolved `lang`.
 */
export function localeAlternates(
  basePath: string,
  lang: Lang,
): { canonical: string; languages: Record<string, string> } {
  const ar = localePath(basePath, 'ar');
  return {
    canonical: lang === 'ar' ? ar : basePath,
    languages: { en: basePath, ar, 'x-default': basePath },
  };
}
