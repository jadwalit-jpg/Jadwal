'use client';

/**
 * Loads Google Ads (gtag.js) and fires a page_view on every client-side
 * navigation. Rendered once in the root layout, right beside <MetaPixel>.
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
import { GOOGLE_ADS_ID } from '@/lib/gtag';

function loadGtag(id: string): void {
  if (window.gtag) return;
  window.dataLayer = window.dataLayer || [];
  // gtag.js reads the raw `arguments` object positionally — keep the vendor
  // bootstrap verbatim (a rest-array would not be read the same way).
  /* eslint-disable prefer-rest-params -- gtag's bootstrap depends on `arguments` */
  function gtag() {
    window.dataLayer!.push(arguments);
  }
  /* eslint-enable prefer-rest-params */
  window.gtag = gtag as (...args: unknown[]) => void;

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);

  window.gtag('js', new Date());
  window.gtag('config', id);
}

/** Skip our own dashboards — the tag is for customer-facing pages only. */
function isTrackablePath(pathname: string | null): boolean {
  return !!pathname && !/^\/(admin|vendor)(\/|$)/.test(pathname);
}

export default function GoogleAds() {
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
    if (!allowed || !GOOGLE_ADS_ID || !isTrackablePath(pathname)) return;
    if (!loaded.current) {
      loadGtag(GOOGLE_ADS_ID);
      loaded.current = true;
    }
  }, [allowed, pathname]);

  // gtag('config') sends the first page_view automatically; fire one on every
  // subsequent client-side navigation.
  useEffect(() => {
    if (!allowed || !GOOGLE_ADS_ID || !isTrackablePath(pathname) || !loaded.current) return;
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
      });
    }
  }, [consent]);

  return null;
}
