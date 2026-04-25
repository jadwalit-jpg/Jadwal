import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import axios from 'axios';

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

/**
 * Safely extract a human-readable error message from any thrown value.
 *
 * Security posture:
 *  - Only the BACKEND's validated error payload (`err.response.data.message`)
 *    is surfaced to the UI. The backend's AllExceptionsFilter + PrismaExceptionFilter
 *    already map every known error class to a whitelisted generic message, so
 *    these strings are safe to display.
 *  - Raw JS `Error.message` strings (from local parse failures, typos, etc.)
 *    are NEVER bubbled up to the UI — they could contain stack hints or
 *    internal file paths. They're intentionally swallowed in favour of the
 *    generic `fallback`.
 *  - The returned string is length-capped so a compromised or misbehaving
 *    backend can't push a 10 MB blob into a toast.
 *
 * Usage:
 *   onError: (err) => toast(getApiError(err, 'Failed to save'), 'error')
 *   catch (err) { setError(getApiError(err, 'Something went wrong')); }
 */
export function getApiError(err: unknown, fallback = 'Something went wrong'): string {
  const MAX_LEN = 500;
  const trim = (s: string) => (s.length > MAX_LEN ? `${s.slice(0, MAX_LEN)}…` : s);
  if (axios.isAxiosError(err)) {
    const msg: unknown = err.response?.data?.message;
    if (typeof msg === 'string' && msg.length > 0) return trim(msg);
    if (Array.isArray(msg) && typeof msg[0] === 'string') return trim(msg[0]);
  }
  // Intentionally no `Error.message` leak path — the backend's filters
  // produce the only user-facing strings we trust.
  return fallback;
}
