'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/auth-context';
import { useGeo } from '@/context/geo-context';
import { PhoneVerificationModal } from './phone-verification-modal';

const DISMISS_KEY = 'jadwal_phone_prompt_dismissed';

export function PhonePrompt() {
  const { user, loading, checkAuth } = useAuth();
  const { country } = useGeo();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) return;
    if (user.role !== 'CUSTOMER') return;
    if (user.phoneVerified) return;

    // Check if already dismissed this session
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === user.id) return;
    } catch { /* SSR or private browsing */ }

    const timer = setTimeout(() => setShow(true), 1500);
    return () => clearTimeout(timer);
  }, [user, loading]);

  // Belt-and-suspenders render guard: even if `show` is true (e.g. timer
  // fired while user was authenticated), the modal must NOT render unless
  // the user is a logged-in CUSTOMER who hasn't verified their phone.
  // Without this, a logged-in customer who toggles `show=true` and then
  // logs out would still see a stale modal that posts to /auth/phone/*
  // and would fail with a "Session expired" 401 — confusing UX, mild
  // info disclosure ("Unauthorized" tells the user the endpoint exists).
  if (
    !show ||
    loading ||
    !user ||
    user.role !== 'CUSTOMER' ||
    user.phoneVerified
  ) {
    return null;
  }

  return (
    <PhoneVerificationModal
      isOpen={show}
      onClose={() => {
        setShow(false);
        try { sessionStorage.setItem(DISMISS_KEY, user.id); } catch {}
      }}
      onVerified={() => {
        setShow(false);
        try { sessionStorage.removeItem(DISMISS_KEY); } catch {}
        checkAuth();
      }}
      initialPhone={user.phone || ''}
      detectedCountryIso={country?.isoCode}
      allowSkip
    />
  );
}
