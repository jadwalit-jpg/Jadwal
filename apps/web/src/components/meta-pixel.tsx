'use client';

/**
 * Loads the Meta (Facebook) Pixel AFTER cookie consent and fires a PageView on
 * every client-side navigation. Rendered once in the root layout.
 *
 * CSP: the app's script-src uses 'strict-dynamic', so a <script> element
 * inserted by our (nonce-trusted) bundle is itself trusted — fbevents.js loads
 * without any script-src allowlist entry or nonce. Only Facebook's beacon
 * endpoints need img-src / connect-src entries (see middleware.ts).
 *
 * Not active on /admin or /vendor routes — we don't track our own staff.
 */

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCookieConsent } from '@/context/cookie-consent';
import { FB_PIXEL_ID } from '@/lib/fb-pixel';

function loadPixel(id: string): void {
  if (window.fbq) return;
  /* eslint-disable @typescript-eslint/no-explicit-any -- fbq's self-referential bootstrap is inherently untyped */
  const n: any = function (...args: unknown[]) {
    if (n.callMethod) n.callMethod(...args);
    else n.queue.push(args);
  };
  n.queue = [];
  n.push = n;
  n.loaded = true;
  n.version = '2.0';
  window.fbq = n;
  if (!window._fbq) window._fbq = n;

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(script);

  n('init', id);
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Skip our own dashboards — the pixel is for customer-facing pages only. */
function isTrackablePath(pathname: string | null): boolean {
  return !!pathname && !/^\/(admin|vendor)(\/|$)/.test(pathname);
}

export default function MetaPixel() {
  const { consent } = useCookieConsent();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const loaded = useRef(false);

  // Load the pixel once, the first time consent is granted on a customer page.
  useEffect(() => {
    if (consent !== 'accepted' || !FB_PIXEL_ID || !isTrackablePath(pathname)) return;
    if (!loaded.current) {
      loadPixel(FB_PIXEL_ID);
      loaded.current = true;
    }
  }, [consent, pathname]);

  // Fire PageView on first load + every subsequent client-side navigation.
  useEffect(() => {
    if (consent !== 'accepted' || !FB_PIXEL_ID || !isTrackablePath(pathname)) return;
    window.fbq?.('track', 'PageView');
  }, [consent, pathname, searchParams]);

  return null;
}
