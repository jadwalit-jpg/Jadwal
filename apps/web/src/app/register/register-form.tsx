'use client';

/**
 * Interactive register form. Owns all form state + auth side-effects so
 * the surrounding /register page.tsx can stay a server component —
 * letting the background image (the LCP element) paint from the first
 * byte of HTML instead of waiting on the React Query / i18n / auth
 * provider chain.
 *
 * Extracted from register/page.tsx (2026-04-26).
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/auth-context';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { sanitize, validateEmail, validatePassword, validateFullName, validatePhone } from '@/lib/validation';
import { getApiError } from '@/lib/api-error';
import api, { API_BASE } from '@/lib/api';

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

export default function RegisterForm() {
  const { t } = useTranslation();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');

  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.push('/');
  }, [user, loading, router]);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError('');

    const nameCheck = validateFullName(fullName);
    if (!nameCheck.valid) { setError(nameCheck.error); return; }

    const emailCheck = validateEmail(email);
    if (!emailCheck.valid) { setError(emailCheck.error); return; }

    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) { setError(pwCheck.error); return; }

    if (phone) {
      const phoneCheck = validatePhone(phone);
      if (!phoneCheck.valid) { setError(phoneCheck.error); return; }
    }

    setIsSubmitting(true);
    try {
      await api.post('/auth/register', {
        fullName: sanitize(fullName),
        email: sanitize(email),
        password,
        phone: phone ? sanitize(phone) : undefined,
      });
      setPendingEmail(sanitize(email));
    } catch (err: unknown) {
      setError(getApiError(err, 'Registration failed. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setResendMessage('');
    try {
      await api.post('/auth/resend-verification', { email: pendingEmail });
      setResendMessage('A new verification link has been sent.');
    } catch {
      setResendMessage('Something went wrong. Please try again.');
    } finally {
      setResending(false);
    }
  };

  // Same fix as login-form: reserve the form footprint during the auth
  // bootstrap so the glass-surface card doesn't grow when the form
  // mounts. Register has 4 inputs + terms text so the floor is taller
  // than login (44rem vs 34rem).
  if (loading) return <div className="min-h-176" aria-hidden />;

  if (pendingEmail) {
    return (
      <div className="text-center py-2">
        <div className="mx-auto mb-6 w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
          <svg className="h-8 w-8 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-white mb-2">{t('auth.checkInbox')}</h2>
        <p className="text-sm text-white/40 mb-1">{t('auth.sentVerificationTo')}</p>
        <p className="text-sm font-medium text-blue-400 mb-6">{pendingEmail}</p>
        <p className="text-xs text-white/25 mb-6">{t('auth.linkExpires')}</p>

        <div className="space-y-3">
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="w-full py-2.5 glass-btn text-sm text-white/60 hover:text-white/80 disabled:opacity-50"
          >
            {resending ? t('auth.sending') : t('auth.resendVerification')}
          </button>
          {resendMessage && (
            <p className="text-xs text-emerald-400">{resendMessage}</p>
          )}
          <Link href="/login" className="block text-center text-xs text-white/30 hover:text-white/50 transition-colors">
            {t('auth.backToLogin')}
          </Link>
        </div>
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
        <h1 className="text-xl font-bold text-white text-center mb-1">{t('auth.createAccount')}</h1>
        <p className="text-sm text-white/40 text-center">{t('auth.startExploring')}</p>
      </div>

      <button
        type="button"
        onClick={() => { window.location.href = `${API_BASE}/auth/google`; }}
        className="glass-btn w-full flex items-center justify-center gap-2.5 px-4 py-3 text-sm font-medium text-white/80"
      >
        <GoogleIcon />
        {t('auth.continueWithGoogle')}
      </button>

      <div className="flex items-center gap-4 my-6">
        <div className="h-px bg-white/10 flex-1" />
        <span className="text-white/25 text-xs">{t('auth.or')}</span>
        <div className="h-px bg-white/10 flex-1" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
            <p className="text-red-400 text-sm font-medium">{error}</p>
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="register-full-name" className="text-sm font-medium text-white/50 ms-0.5">{t('auth.fullName')}</label>
          <input
            id="register-full-name"
            name="fullName"
            type="text"
            autoComplete="name"
            required
            placeholder="John Doe"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="glass-input w-full px-4 py-3 text-sm text-white outline-none placeholder:text-white/25"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="register-email" className="text-sm font-medium text-white/50 ms-0.5">{t('auth.emailAddress')}</label>
          <input
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="glass-input w-full px-4 py-3 text-sm text-white outline-none placeholder:text-white/25"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="register-password" className="text-sm font-medium text-white/50 ms-0.5">{t('auth.password')}</label>
          <input
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            placeholder={t('auth.passwordHint')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="glass-input w-full px-4 py-3 text-sm text-white outline-none placeholder:text-white/25"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="register-phone" className="text-sm font-medium text-white/50 ms-0.5">
            {t('auth.phone')} <span className="text-white/20">({t('auth.optional')})</span>
          </label>
          <input
            id="register-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="+974 1234 5678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="glass-input w-full px-4 py-3 text-sm text-white outline-none placeholder:text-white/25"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-all active:scale-[0.98] disabled:opacity-50 shadow-lg shadow-blue-600/25"
        >
          {isSubmitting ? t('auth.creatingAccount') : t('auth.createAccountBtn')}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-white/30">
        {t('auth.hasAccount')}{' '}
        <Link href="/login" className="text-blue-400 font-semibold hover:text-blue-300 transition-colors">
          {t('auth.signInLink')}
        </Link>
      </p>

      <p className="mt-4 text-center text-xs text-white/20">
        {t('auth.agreeTerms')}{' '}
        <Link href="/terms" className="underline hover:text-white/40">{t('terms.title')}</Link>
        {' '}{t('auth.and')}{' '}
        <Link href="/privacy" className="underline hover:text-white/40">{t('privacy.title')}</Link>
      </p>
    </>
  );
}
