/**
 * PAY2M form-action runtime allowlist.
 *
 * The /payment/initiate API returns a `formAction` URL the browser POSTs the
 * checkout form to. Even though the URL is built server-side from a trusted
 * env var (PAY2M_API_URL), we double-check on the client before submitting:
 * if the API response is ever tampered with (compromised host, rogue proxy,
 * stored-XSS-bypassed CSP), the browser will refuse to submit the form to
 * an unknown origin.
 *
 * This is belt-and-suspenders behind the CSP `form-action` directive set in
 * middleware.ts and the backend env validation.
 */

const DEFAULT_ALLOWED_ORIGINS = ['https://pay.pay2m.com'] as const;

function readAllowedOriginsFromEnv(): readonly string[] {
  const raw = process.env.NEXT_PUBLIC_PAY2M_ALLOWED_ORIGINS;
  if (!raw) return DEFAULT_ALLOWED_ORIGINS;
  const parsed = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_ALLOWED_ORIGINS;
}

export const PAY2M_ALLOWED_ORIGINS = readAllowedOriginsFromEnv();

/**
 * Validate that the given URL has a known PAY2M origin AND uses HTTPS.
 * Refuses any other scheme (javascript:, data:, http:, etc.) so a tampered
 * formAction can never trigger an XSS or downgrade the connection. Also
 * refuses embedded credentials (`https://user:pass@host/...`) — even though
 * URL.origin strips them, leaving them in would mean the browser sends a
 * Basic-Auth header to PAY2M, which is never legitimate for this flow and
 * smells like a tampered URL.
 */
export function isAllowedPay2mFormAction(formAction: string): boolean {
  if (typeof formAction !== 'string' || formAction.length === 0) return false;
  let url: URL;
  try {
    url = new URL(formAction);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  if (!url.hostname) return false;
  return PAY2M_ALLOWED_ORIGINS.includes(url.origin);
}
