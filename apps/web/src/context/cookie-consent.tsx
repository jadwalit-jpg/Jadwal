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
}

const CookieConsentContext = createContext<CookieConsentValue>({
  consent: null,
  hydrated: false,
  accept: () => {},
  decline: () => {},
});

export function CookieConsentProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsent] = useState<CookieConsent>(null);
  const [hydrated, setHydrated] = useState(false);

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
  }, []);

  const accept = useCallback(() => persist('accepted'), [persist]);
  const decline = useCallback(() => persist('declined'), [persist]);

  return (
    <CookieConsentContext.Provider value={{ consent, hydrated, accept, decline }}>
      {children}
    </CookieConsentContext.Provider>
  );
}

export function useCookieConsent(): CookieConsentValue {
  return useContext(CookieConsentContext);
}
