/**
 * Microsoft Clarity helpers.
 *
 * The project ID is PUBLIC (it ships in the page source of every site running
 * Clarity) — not a secret. Overridable at build time via NEXT_PUBLIC_CLARITY_ID;
 * set it to an empty string to disable Clarity entirely (e.g. staging). The
 * hardcoded fallback is the ID the SEO team supplied so it works without a
 * pipeline/env change.
 *
 * Clarity is NOT the same class of tool as an analytics counter: it records
 * SESSION REPLAYS — mouse movement, clicks, scrolling and page content — so on
 * a booking site it can capture a customer's name, phone and trip details
 * unless it is constrained. Two constraints are enforced in code (see
 * components/clarity.tsx):
 *
 *   1. It never loads on the money path (checkout, payment callback) or on
 *      account pages, so those screens are never recorded at all.
 *   2. It loads only for visitors who have not declined cookies, and a later
 *      decline revokes consent via `clarity('consent', false)`.
 *
 * A THIRD constraint cannot be set from code and must be set once in the
 * Clarity dashboard: Settings -> Masking -> **Strict**. That masks all text and
 * input values in replays. Balanced (the default) masks input values only, and
 * would still record page text such as a customer's name in a booking summary.
 */

declare global {
  interface Window {
    clarity?: (...args: unknown[]) => void;
  }
}

export const CLARITY_PROJECT_ID = process.env.NEXT_PUBLIC_CLARITY_ID ?? 'y4xknitrzo';

/**
 * Routes Clarity must never record.
 *
 * - /admin, /vendor      our own staff dashboards; we don't record employees
 * - /activity/../book    checkout: guest names, phone numbers, prices
 * - /payment             gateway return path, carries transaction identifiers
 * - /profile, /bookings  a signed-in customer's own personal data
 * - auth routes          credentials, reset tokens in the URL
 */
const BLOCKED = [
  /^\/(admin|vendor)(\/|$)/,
  /^\/activity\/[^/]+\/book(\/|$)/,
  /^\/payment(\/|$)/,
  /^\/(profile|bookings|likes)(\/|$)/,
  /^\/(login|register|forgot-password|reset-password|verify-email)(\/|$)/,
];

/** True only for pages Clarity is allowed to record. */
export function isClarityAllowedPath(pathname: string | null): boolean {
  return !!pathname && !BLOCKED.some((re) => re.test(pathname));
}
