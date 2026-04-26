'use client';

/**
 * Interactive login form. Owns all form state + auth side-effects so the
 * surrounding /login page.tsx can stay a server component — letting the
 * background image (the LCP element) paint from the first byte of HTML
 * instead of waiting on the React Query / i18n / auth provider chain.
 *
 * Extracted from login/page.tsx (2026-04-26).
 */

import React, { useState, useEffect, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/auth-context';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { validateLoginForm, sanitize } from '@/lib/validation';
import api, { API_BASE } from '@/lib/api';
import { getApiError } from '@/lib/api-error';

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

export default function LoginForm() {
  return (
    <Suspense>
      <LoginFormContent />
    </Suspense>
  );
}

function LoginFormContent() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [resendDone, setResendDone] = useState(false);
  const [resendError, setResendError] = useState(false);

  const { login, user, loading, checkAuth } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Security: only allow relative paths — block open redirect
  const raw = searchParams.get('callbackUrl') ?? '';
  const callbackUrl = raw.startsWith('/') && !raw.startsWith('//') && !raw.includes(':') ? raw : null;
  const oauthError = searchParams.get('error');

  useEffect(() => {
    if (oauthError === 'deactivated') setError(t('auth.oauthDeactivated'));
    else if (oauthError === 'suspended') setError(t('auth.oauthVendorSuspended'));
    else if (oauthError === 'oauth_failed') setError(t('auth.oauthGoogleFailed'));
  }, [oauthError, t]);

  useEffect(() => {
    if (!loading && user) {
      if (user.role === 'CUSTOMER') router.push(callbackUrl || '/');
    }
  }, [user, loading, router, callbackUrl]);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError('');

    const sanitizedEmail = sanitize(email);
    const check = validateLoginForm(sanitizedEmail, password);
    if (!check.valid) {
      setError(check.error);
      return;
    }

    setIsSubmitting(true);

    try {
      const loggedInUser = await login(sanitizedEmail, password);
      if (loggedInUser.role !== 'CUSTOMER') {
        await api.post('/auth/logout');
        await checkAuth();
        setError('Please use the appropriate portal to sign in.');
        setIsSubmitting(false);
        return;
      }
      setShowSuccess(true);
      setTimeout(() => {
        router.push(callbackUrl || '/');
      }, 1500);
    } catch (err) {
      const msg = getApiError(err, '');
      if (msg === 'EMAIL_NOT_VERIFIED') {
        setUnverifiedEmail(sanitizedEmail);
      } else {
        setError(msg || 'Invalid email or password');
      }
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setResendError(false);
    try {
      await api.post('/auth/resend-verification', { email: unverifiedEmail });
      setResendDone(true);
    } catch {
      setResendError(true);
    } finally {
      setResending(false);
    }
  };

  // During the auth bootstrap, the glass-surface card would otherwise
  // collapse to padding-only height, mount the full form once auth
  // resolves, and produce a ~0.26 CLS hit on /login (Lighthouse mobile).
  // Reserve the form's footprint so the card stays the same size from
  // first paint through hydration. `aria-hidden` keeps the placeholder
  // out of the a11y tree.
  if (loading) return <div className="min-h-136" aria-hidden />;

  if (showSuccess) {
    return (
      <div className="text-center py-4">
        <div className="mb-6">
          <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">{t('auth.youreIn')}</h2>
        <p className="text-sm text-white/40">{t('auth.redirecting')}</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex justify-center mb-8">
        <Link href="/" className="flex items-center gap-1 font-bold">
          <span className="text-2xl text-white">Jadwal</span>
          <span className="text-2xl text-blue-400">جدول</span>
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-xl font-bold text-white text-center mb-1">{t('auth.welcomeBack')}</h1>
        <p className="text-sm text-white/40 text-center">{t('auth.signInToAccount')}</p>
      </div>

      <button
        type="button"
        onClick={() => {
          const dest = callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : '';
          window.location.href = `${API_BASE}/auth/google${dest}`;
        }}
        className="glass-btn w-full flex items-center justify-center gap-2.5 px-4 py-3 text-sm font-medium text-white/80"
      >
        <GoogleIcon />
        {t('auth.signInWithGoogle')}
      </button>

      <div className="flex items-center gap-4 my-6">
        <div className="h-px bg-white/10 flex-1" />
        <span className="text-white/25 text-xs">{t('auth.or')}</span>
        <div className="h-px bg-white/10 flex-1" />
      </div>

      {unverifiedEmail && (
        <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-2">
          <p className="text-amber-400 text-sm font-medium">{t('auth.verifyEmailFirst')}</p>
          {resendDone ? (
            <p className="text-xs text-emerald-400">{t('auth.newLinkSent')}</p>
          ) : (
            <>
              <button
                type="button"
                onClick={handleResend}
                disabled={resending}
                className="text-xs text-amber-400/70 hover:text-amber-400 underline disabled:opacity-50 transition-colors"
              >
                {resending ? t('auth.sending') : t('auth.resendVerification')}
              </button>
              {resendError && (
                <p className="text-xs text-red-400">{t('auth.failedToSend')}</p>
              )}
            </>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
            <p className="text-red-400 text-sm font-medium">{error}</p>
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="login-email" className="text-sm font-medium text-white/50 ms-0.5">{t('auth.emailAddress')}</label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="name@example.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setUnverifiedEmail(''); setResendDone(false); setResendError(false); }}
            className="glass-input w-full px-4 py-3 text-sm text-white outline-none placeholder:text-white/25"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between items-center ms-0.5">
            <label htmlFor="login-password" className="text-sm font-medium text-white/50">{t('auth.password')}</label>
            <Link href="/forgot-password" className="text-xs text-blue-400/70 hover:text-blue-400 transition-colors">
              {t('auth.forgotPassword')}
            </Link>
          </div>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="glass-input w-full px-4 py-3 text-sm text-white outline-none placeholder:text-white/25"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-all active:scale-[0.98] disabled:opacity-50 shadow-lg shadow-blue-600/25"
        >
          {isSubmitting ? t('auth.signingIn') : t('auth.signIn')}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-white/30">
        {t('auth.noAccount')}{' '}
        <Link href="/register" className="text-blue-400 font-semibold hover:text-blue-300 transition-colors">
          {t('auth.signUp')}
        </Link>
      </p>
    </>
  );
}
