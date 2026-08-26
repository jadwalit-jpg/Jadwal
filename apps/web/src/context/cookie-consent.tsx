'use client';

/**
 * Cookie-consent state for analytics/marketing cookies (the Meta Pixel).
 *
 * Distinct from Terms acceptance (terms-consent-gate.tsx) — this governs
 * whether third-party tracking may load. Decision is persisted in
 * localStorage so it survives reloads; `hydrated` guards against a
 * server/client flash of the banner before we've read that storage.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type CookieConsent = 'accepted' | 'declined' | null;

const STORAGE_KEY = 'jadwal_cookie_consent';

interface CookieConsentValue {
  consent: CookieConsent;
  /** true once we've read the stored decision on the client (avoids SSR flash). */
  hydrated: boolean;
  accept: () => void;
  decline: () => void;
  /** Whether the banner should be on screen (undecided, or re-opened). */
  bannerOpen: boolean;
  /** Re-open the banner so a past decision can be changed (PDPPL Article 4). */
  reopen: () => void;
}

const CookieConsentContext = createContext<CookieConsentValue>({
  consent: null,
  hydrated: false,
  accept: () => {},
  decline: () => {},
  bannerOpen: false,
  reopen: () => {},
});

export function CookieConsentProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsent] = useState<CookieConsent>(null);
  const [hydrated, setHydrated] = useState(false);
  // Re-opening shows the banner again WITHOUT clearing the stored decision.
  //
  // Under the old opt-out model this was a hard legal requirement: `null` meant
  // TRACKED, so clearing the decision would have flipped a visitor who had
  // declined back into tracking for as long as the banner sat open — the act of
  // withdrawing consent would have started the very processing it was meant to
  // stop. Consent is opt-in now (2026-08-26), so `null` is the safe state and
  // that specific trap is gone.
  //
  // The behaviour stays because it is still the correct one: a visitor who
  // opens preferences and then closes them without choosing should keep the
  // choice they already made, not silently lose it. Nothing here should be
  // "simplified" back to clearing the value.
  const [reopened, setReopened] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'accepted' || stored === 'declined') setConsent(stored);
    } catch {
      // localStorage unavailable (private mode / blocked) — treat as no decision.
    }
    setHydrated(true);
  }, []);

  const persist = useCallback((value: Exclude<CookieConsent, null>) => {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Non-fatal: consent still applies for this session via state.
    }
    setConsent(value);
    setReopened(false); // a fresh decision closes the banner
  }, []);

  const accept = useCallback(() => persist('accepted'), [persist]);
  const decline = useCallback(() => persist('declined'), [persist]);
  const reopen = useCallback(() => setReopened(true), []);

  // Undecided visitors see it automatically; anyone else only on request.
  const bannerOpen = hydrated && (consent === null || reopened);

  return (
    <CookieConsentContext.Provider
      value={{ consent, hydrated, accept, decline, bannerOpen, reopen }}
    >
      {children}
    </CookieConsentContext.Provider>
  );
}

export function useCookieConsent(): CookieConsentValue {
  return useContext(CookieConsentContext);
}
