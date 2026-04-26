'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { useAuth } from '@/context/auth-context';

function VerifyEmailContent() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  const searchParams = useSearchParams();
  const router = useRouter();
  const { checkAuth } = useAuth();

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setErrorMsg('No verification token found in the link.');
      return;
    }

    api.get(`/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(async () => {
        await checkAuth();
        setStatus('success');
        setTimeout(() => router.push('/'), 2500);
      })
      .catch((err: unknown) => {
        setStatus('error');
        setErrorMsg(getApiError(err, 'Verification failed. The link may have expired.'));
      });
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative min-h-svh font-outfit overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat scale-105"
        style={{ backgroundImage: "url('/images/login-bg.webp')" }}
      />
      <div className="absolute inset-0 bg-black/25" />

      <div className="relative z-10 flex min-h-svh items-center justify-center p-6">
        <div className="glass-surface w-full max-w-sm p-8 text-center">
          <div className="absolute -top-20 -inset-e-20 w-40 h-40 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -inset-s-20 w-40 h-40 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10">
            {status === 'loading' && (
              <>
                <div className="mx-auto mb-6 w-16 h-16 rounded-full border border-white/10 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-blue-400/40 border-t-blue-400 rounded-full animate-spin" />
                </div>
                <h2 className="text-xl font-bold text-white mb-2">{t('auth.verifyingEmail')}</h2>
                <p className="text-sm text-white/40">{t('auth.justAMoment')}</p>
              </>
            )}

            {status === 'success' && (
              <>
                <div className="mx-auto mb-6 w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <svg className="h-8 w-8 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-white mb-2">{t('auth.emailVerified')}</h2>
                <p className="text-sm text-white/40">{t('auth.allSet')}</p>
              </>
            )}

            {status === 'error' && (
              <>
                <div className="mx-auto mb-6 w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                  <svg className="h-8 w-8 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-white mb-2">{t('auth.linkInvalidOrExpired')}</h2>
                <p className="text-sm text-white/40 mb-6">{errorMsg}</p>
                <Link
                  href="/register"
                  className="inline-block px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-all"
                >
                  {t('auth.backToSignUp')}
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}
