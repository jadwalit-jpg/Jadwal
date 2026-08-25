'use client';

/**
 * Loads Microsoft Clarity (session replay + heatmaps). Rendered once in the
 * root layout, beside <MetaPixel> and <GoogleTag>.
 *
 * Consent = OPT-OUT, matching the Meta Pixel and the Google tag so every
 * analytics platform on the site behaves identically: Clarity loads by DEFAULT
 * once the stored choice is read, EXCEPT for visitors who explicitly clicked
 * "Decline". Declining after load calls `clarity('consent', false)` so Microsoft
 * stops collecting.
 *
 * WHAT MAKES THIS DIFFERENT from the other two: Clarity records what the user
 * actually sees and does, so the blast radius of getting it wrong is a replay
 * containing a real customer's booking details. Constrained three ways:
 *
 *   1. NEVER loads on the money path or account pages — see
 *      lib/clarity.ts `isClarityAllowedPath`. Checkout, payment return,
 *      profile, bookings and the auth flows are excluded outright, so those
 *      screens are not recorded even for a consenting visitor.
 *   2. Unlike the pixel and gtag, it is torn down on navigation INTO an
 *      excluded route: consent is revoked rather than merely not re-fired,
 *      because a single-page navigation from /explore into /activity/x/book
 *      would otherwise keep the existing recorder running on the checkout page.
 *   3. Masking = Strict must be set once in the Clarity dashboard
 *      (Settings -> Masking). That is a portal setting with no code equivalent;
 *      without it Clarity masks input values but still records page text.
 *
 * CSP: script-src uses 'strict-dynamic', so a <script> inserted by our
 * (nonce-trusted) bundle is itself trusted — clarity.ms/tag loads with no
 * script-src entry. Its beacon hosts need connect-src (see middleware.ts).
 */

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useCookieConsent } from '@/context/cookie-consent';
import { onIdle, type IdleDisposer } from '@/lib/defer-idle';
import { CLARITY_PROJECT_ID, isClarityAllowedPath } from '@/lib/clarity';

function loadClarity(id: string): IdleDisposer {
  if (window.clarity) return () => false;
  /* eslint-disable @typescript-eslint/no-explicit-any -- Clarity's bootstrap queue is untyped by design */
  const w = window as any;
  w.clarity =
    w.clarity ||
    function (...args: unknown[]) {
      (w.clarity.q = w.clarity.q || []).push(args);
    };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Only the tag download waits for idle; the stub above already buffers into
  // clarity.q, which the tag drains on load — so the `consent` call the caller
  // makes right after this still reaches Microsoft.
  return onIdle(() => {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.clarity.ms/tag/${encodeURIComponent(id)}`;
    document.head.appendChild(script);
  });
}

export default function Clarity() {
  const { consent, hydrated } = useCookieConsent();
  const pathname = usePathname();
  const loaded = useRef(false);
  // Cancels the pending tag download if consent is withdrawn, or if the visitor
  // navigates onto an excluded route, before it has actually been requested.
  const dispose = useRef<IdleDisposer | null>(null);

  // Opt-out: allowed once the stored choice is read (`hydrated`) unless the
  // visitor previously declined. Waiting for `hydrated` ensures a prior
  // "Decline" is respected before anything loads.
  const allowed = hydrated && consent !== 'declined';

  useEffect(() => {
    if (!CLARITY_PROJECT_ID) return;

    const recordable = allowed && isClarityAllowedPath(pathname);

    if (recordable) {
      if (!loaded.current) {
        dispose.current = loadClarity(CLARITY_PROJECT_ID);
        loaded.current = true;
      }
      window.clarity?.('consent');
      return;
    }

    // Not recordable: either consent was withdrawn or the visitor navigated
    // into an excluded route (checkout, payment, account, auth). Clarity cannot
    // be unloaded, so revoke consent — that is what actually stops collection.
    // Cancel a download that has not started — far better than fetching a
    // session recorder we are about to switch off. Unlike the other two this
    // branch is also hit by simply navigating onto checkout, so clearing the
    // latch matters: navigating back to an allowed page must be able to
    // schedule the tag again.
    const prevented = dispose.current?.() ?? false;
    dispose.current = null;
    if (prevented) loaded.current = false;
    else if (loaded.current) window.clarity?.('consent', false);
  }, [allowed, pathname]);

  return null;
}
