'use client';

/**
 * Loads the Google tag (gtag.js) and fires a page_view on every client-side
 * navigation. Rendered once in the root layout, right beside <MetaPixel>.
 *
 * ONE script, TWO destinations: Google Ads (AW-…) and Google Analytics 4
 * (G-…). gtag.js is designed for this — load once, then `config` per ID.
 * Loading it twice would double-count every page_view.
 *
 * Consent = OPT-OUT (mirrors MetaPixel): gtag loads by DEFAULT for every
 * visitor once the stored choice is read, EXCEPT visitors who explicitly
 * clicked "Decline" (consent === 'declined'). Declining after load calls
 * gtag('consent','update', ...denied) so Google stops using the data. (An
 * Accept-first gate kills ad-conversion tracking because most ad visitors
 * never click Accept — same reasoning as the Meta Pixel.)
 *
 * CSP: the app's script-src uses 'strict-dynamic', so a <script> element
 * inserted by our (nonce-trusted) bundle is itself trusted — gtag.js and every
 * script it loads run without any script-src allowlist entry or nonce. Only
 * Google's beacon endpoints need img-src / connect-src entries (see
 * middleware.ts).
 *
 * Not active on /admin or /vendor routes — we don't track our own staff.
 */

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCookieConsent } from '@/context/cookie-consent';
import { GA4_MEASUREMENT_ID, GOOGLE_ADS_ID } from '@/lib/gtag';

function loadGtag(ids: string[]): void {
  if (window.gtag || ids.length === 0) return;
  window.dataLayer = window.dataLayer || [];
  // gtag.js reads the raw `arguments` object positionally — keep the vendor
  // bootstrap verbatim (a rest-array would not be read the same way).
  /* eslint-disable prefer-rest-params -- gtag's bootstrap depends on `arguments` */
  function gtag() {
    window.dataLayer!.push(arguments);
  }
  /* eslint-enable prefer-rest-params */
  window.gtag = gtag as (...args: unknown[]) => void;

  // The ?id= on the loader URL only bootstraps the first destination; the
  // `config` calls below are what actually register each one.
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ids[0])}`;
  document.head.appendChild(script);

  window.gtag('js', new Date());
  // send_page_view:false — `config` fires an automatic page_view per
  // destination, and the navigation effect below fires one too, so the default
  // double-counts EVERY first page load. Harmless for Ads (page_view is not the
  // conversion metric) but it would inflate GA4 sessions/pageviews, which is
  // the SEO team's core number. Suppressing it here makes that effect the one
  // and only source of page_view.
  for (const id of ids) window.gtag('config', id, { send_page_view: false });
}

/** Ads + GA4, minus any that were blanked out via env to disable them. */
function activeIds(): string[] {
  return [GOOGLE_ADS_ID, GA4_MEASUREMENT_ID].filter(Boolean);
}

/** Skip our own dashboards — the tag is for customer-facing pages only. */
function isTrackablePath(pathname: string | null): boolean {
  return !!pathname && !/^\/(admin|vendor)(\/|$)/.test(pathname);
}

export default function GoogleTag() {
  const { consent, hydrated } = useCookieConsent();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const loaded = useRef(false);

  // Opt-out: allowed by default once the stored choice is read (`hydrated`),
  // unless the visitor previously declined. Waiting for `hydrated` ensures a
  // prior "Decline" is respected before anything fires.
  const allowed = hydrated && consent !== 'declined';

  // Load gtag once, on the first trackable customer page.
  useEffect(() => {
    if (!allowed || !isTrackablePath(pathname)) return;
    if (!loaded.current) {
      const ids = activeIds();
      if (ids.length === 0) return;
      loadGtag(ids);
      loaded.current = true;
    }
  }, [allowed, pathname]);

  // Single source of page_view: `config` has send_page_view disabled, so this
  // fires the FIRST one as well as every client-side navigation after it.
  useEffect(() => {
    if (!allowed || !isTrackablePath(pathname) || !loaded.current) return;
    window.gtag?.('event', 'page_view');
  }, [allowed, pathname, searchParams]);

  // If the visitor declines AFTER gtag already loaded, tell Google to stop
  // using ad data. gtag can't be unloaded, but a consent update halts it.
  useEffect(() => {
    if (consent === 'declined' && loaded.current) {
      window.gtag?.('consent', 'update', {
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        // GA4 stores its own analytics cookies under a separate signal — the ad
        // signals above do NOT cover it, so a decline must deny this too or
        // Analytics keeps collecting after the visitor opted out.
        analytics_storage: 'denied',
      });
    }
  }, [consent]);

  return null;
}
