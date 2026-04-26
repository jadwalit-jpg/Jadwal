import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Defense-in-depth guard for anywhere the client hands a string to
 * `router.push()` / `router.replace()` / `window.location.*` / `<a href>`
 * when that string came from the API or a URL param.
 *
 * Accepts: in-app paths like "/bookings/abc", "/admin/settings?tab=2#foo".
 * Rejects:
 *   - Empty, non-string, or too long inputs (DoS + visual)
 *   - Protocol-relative URLs (`//attacker.com`)
 *   - Absolute URLs (`http://`, `https://`, `mailto:`, `tel:`, `javascript:`,
 *     `data:`, any scheme)
 *   - Backslash-escaped paths (browsers normalize `/\evil.com` to `//evil.com`)
 *   - Control characters, quotes, angle brackets — even though React escapes
 *     them, rejecting early prevents confusion in anchor `href` attrs.
 *
 * Returns true iff the string is a safe in-app relative path.
 */
export function isSafeRelativePath(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  if (raw.length === 0 || raw.length > 512) return false;
  if (!raw.startsWith('/')) return false;
  if (raw.startsWith('//')) return false;
  if (raw.startsWith('/\\')) return false;
  // Any colon anywhere in the path is a protocol marker (e.g. `/foo:bar`
  // can be parsed as scheme `foo`). Safer to reject outright — valid
  // in-app paths never need a literal colon.
  if (raw.includes(':')) return false;
  // Reject control chars, quotes, angle brackets, and NULL.
  if (/[\u0000-\u001F"<>\\]/.test(raw)) return false;
  return true;
}

// `getApiError` lives in `lib/api-error.ts` (it imports `i18n.ts` which
// transitively touches `react-i18next` → React.createContext, breaking
// any Server Component that imports from this file). Update imports to:
//   import { getApiError } from '@/lib/api-error';
