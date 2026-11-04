/**
 * Lightweight custom-event tracking for the booking funnel.
 *
 * One call fans out to every analytics tool that happens to be loaded:
 *   - Microsoft Clarity custom event  → `clarity('event', name)`
 *   - Google Analytics 4 event        → `gtag('event', name, params)`
 * and, in development only (`next dev`), a console line so the funnel can be
 * followed in DevTools without any analytics loaded at all.
 *
 * Safe to call unconditionally: each sink is guarded with a `typeof` check, so
 * it no-ops when the tool is not loaded (no cookie consent, blocked route,
 * disabled ID). Note that Clarity deliberately never loads on checkout /
 * account routes (see lib/clarity.ts), so on those pages only GA4 receives the
 * event.
 *
 * Never pass personal data (names, phone numbers, emails) in `params` — only
 * codes, statuses and amounts.
 */

export type TrackParams = Record<string, string | number | boolean | undefined>;

export function trackEvent(name: string, params?: TrackParams): void {
  if (typeof window === 'undefined') return;

  // Development only. (Positive `=== 'development'` check: CI bans
  // `if (… !== 'production')` blocks because they also run on staging.)
  if (process.env.NODE_ENV === 'development') {
    console.info(`[track] ${name}`, params ?? {});
  }

  if (typeof window.clarity === 'function') {
    try {
      window.clarity('event', name);
    } catch {
      /* analytics must never break the page */
    }
  }

  if (typeof window.gtag === 'function') {
    try {
      window.gtag('event', name, params ?? {});
    } catch {
      /* analytics must never break the page */
    }
  }
}
