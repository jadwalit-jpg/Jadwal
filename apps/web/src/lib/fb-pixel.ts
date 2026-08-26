/**
 * Meta (Facebook) Pixel helpers.
 *
 * The pixel ID is PUBLIC (it ships in the page source of every site that runs a
 * pixel) — not a secret. It's overridable at build time via
 * NEXT_PUBLIC_FB_PIXEL_ID; set that to an empty string to disable the pixel
 * entirely (e.g. in staging). The hardcoded fallback is the ID marketing
 * supplied so the pixel works without a pipeline/env change.
 *
 * The pixel is loaded by <MetaPixel> ONLY for visitors who actively accepted
 * cookies (opt-in since 2026-08-26; undecided counts as no) — see
 * components/meta-pixel.tsx + context/cookie-consent.tsx.
 */

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}

export const FB_PIXEL_ID = process.env.NEXT_PUBLIC_FB_PIXEL_ID ?? '1369351807915972';

/**
 * Fire a Meta Pixel event (e.g. 'Purchase', 'CompleteRegistration',
 * 'InitiateCheckout'). Safe to call unconditionally from anywhere in the
 * customer flow: it no-ops until the pixel is loaded, and under opt-in the
 * pixel only loads for a visitor who accepted — so anyone who declined OR never
 * chose is never tracked, and callers do not need to know the consent state.
 */
export function fbTrack(event: string, params?: Record<string, unknown>): void {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return;
  if (params) window.fbq('track', event, params);
  else window.fbq('track', event);
}
