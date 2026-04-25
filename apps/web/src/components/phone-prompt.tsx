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

  if (!show) return null;

  return (
    <PhoneVerificationModal
      isOpen={show}
      onClose={() => {
        setShow(false);
        try { sessionStorage.setItem(DISMISS_KEY, user?.id || 'dismissed'); } catch {}
      }}
      onVerified={() => {
        setShow(false);
        try { sessionStorage.removeItem(DISMISS_KEY); } catch {}
        checkAuth();
      }}
      initialPhone={user?.phone || ''}
      detectedCountryIso={country?.isoCode}
      allowSkip
    />
  );
}
