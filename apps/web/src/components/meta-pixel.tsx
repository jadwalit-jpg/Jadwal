'use client';

/**
 * Loads the Meta (Facebook) Pixel and fires a PageView on every client-side
 * navigation. Rendered once in the root layout.
 *
 * Consent = OPT-OUT: the pixel loads by DEFAULT for every visitor once the
 * stored choice is read, EXCEPT visitors who explicitly clicked "Decline"
 * (consent === 'declined'). Declining after load calls fbq('consent','revoke')
 * so Meta stops receiving events. (An Accept-first gate killed ad-conversion
 * tracking because most ad visitors never click Accept.)
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
import { onIdle, type IdleDisposer } from '@/lib/defer-idle';
import { FB_PIXEL_ID } from '@/lib/fb-pixel';

function loadPixel(id: string): IdleDisposer {
  if (window.fbq) return () => false;
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

  // The stub above is installed SYNCHRONOUSLY and `init` is queued below, so
  // only the 400 KB fbevents.js download waits for idle. fbq buffers every
  // call in n.queue and fbevents drains it on arrival — nothing is lost.
  const dispose = onIdle(() => {
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(script);
  });

  n('init', id);
  return dispose;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Skip our own dashboards — the pixel is for customer-facing pages only. */
function isTrackablePath(pathname: string | null): boolean {
  return !!pathname && !/^\/(admin|vendor)(\/|$)/.test(pathname);
}

export default function MetaPixel() {
  const { consent, hydrated } = useCookieConsent();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const loaded = useRef(false);
  // Cancels the pending fbevents.js download if the visitor declines first.
  const dispose = useRef<IdleDisposer | null>(null);

  // Opt-out: allowed by default once the stored choice is read (`hydrated`),
  // unless the visitor previously declined. Waiting for `hydrated` ensures a
  // prior "Decline" is respected before anything fires.
  const allowed = hydrated && consent !== 'declined';

  // Load the pixel once, on the first trackable customer page.
  useEffect(() => {
    if (!allowed || !FB_PIXEL_ID || !isTrackablePath(pathname)) return;
    if (!loaded.current) {
      dispose.current = loadPixel(FB_PIXEL_ID);
      loaded.current = true;
    }
  }, [allowed, pathname]);

  // Fire PageView on first load + every subsequent client-side navigation.
  useEffect(() => {
    if (!allowed || !FB_PIXEL_ID || !isTrackablePath(pathname)) return;
    window.fbq?.('track', 'PageView');
  }, [allowed, pathname, searchParams]);

  // If the visitor declines AFTER the pixel already loaded, tell Meta to stop.
  // fbevents can't be unloaded, but consent-revoke halts further events.
  // Deferring the download opens a window in which the visitor can decline
  // BEFORE we have requested anything. Cancel first: not downloading 685 KB for
  // someone who just opted out beats downloading it and then revoking. If the
  // cancel came too late the script is already on its way, so fall back to the
  // revoke, which is what actually stops Meta processing events.
  useEffect(() => {
    if (consent !== 'declined') return;
    const prevented = dispose.current?.() ?? false;
    dispose.current = null;
    // Never fetched -> clear the latch so a later re-consent can load it.
    if (prevented) loaded.current = false;
    else if (loaded.current) window.fbq?.('consent', 'revoke');
  }, [consent]);

  return null;
}
