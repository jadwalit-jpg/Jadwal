/**
 * Google tag (gtag.js) helpers — shared by Google Ads AND Google Analytics 4.
 *
 * ONE gtag.js script serves both products: it is loaded once and then given a
 * `config` call per destination ID. Loading it twice would double-count every
 * page_view, so <GoogleTag> owns the single loader and both IDs below.
 *
 * The Google Ads conversion ID is PUBLIC (it ships in the page source of every
 * site that runs gtag) — not a secret. It's overridable at build time via
 * NEXT_PUBLIC_GOOGLE_ADS_ID; set that to an empty string to disable Google Ads
 * entirely (e.g. in staging). The hardcoded fallback is the ID the ads team
 * supplied so the tag works without a pipeline/env change.
 *
 * The tag is loaded by <GoogleTag> by DEFAULT (opt-out) for every visitor
 * unless they declined cookies — mirroring the Meta Pixel so every analytics
 * platform behaves identically. See components/google-tag.tsx +
 * context/cookie-consent.tsx.
 */

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID ?? 'AW-11005501487';

/**
 * Google Analytics 4 measurement ID, supplied by the SEO team. Same rules as
 * the Ads ID above: public, not a secret, and settable to '' to disable GA4
 * without touching code (e.g. staging).
 */
export const GA4_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA4_ID ?? 'G-L7XMHJZNQQ';

/**
 * Fire a Google Ads conversion. Safe to call unconditionally from anywhere in
 * the customer flow: it no-ops until gtag is loaded (opt-out — gtag loads by
 * default unless the visitor declined cookies), so a visitor who declined is
 * never tracked and callers don't need to know the consent state.
 *
 * `sendTo` is the conversion label the ads team provides once they create a
 * conversion action, e.g. 'AW-11005501487/AbC-dEfGhIjK'.
 */
export function googleAdsConversion(sendTo: string, params?: Record<string, unknown>): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', 'conversion', { send_to: sendTo, ...params });
}
