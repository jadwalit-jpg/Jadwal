'use client';

/**
 * Authenticated change-password page. Logged-in users land here from the
 * profile menu. The form posts to /auth/change-password (which proves
 * session ownership via currentPassword + JwtAuthGuard) and the API keeps
 * the current refresh token alive while revoking every other session.
 *
 * Differs from /reset-password: that flow needs an emailed token because
 * the user is NOT authenticated. This flow uses the cookie session.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/components/toast';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { validatePassword } from '@/lib/validation';

export default function ChangePasswordPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, loading } = useAuth();
  const { toast } = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Bounce unauthenticated visitors back to login. Defence-in-depth — the
  // API would reject the call anyway, but no point rendering the form for
  // someone who can't submit it.
  useEffect(() => {
    if (!loading && !user) router.replace('/login?next=/account/change-password');
  }, [loading, user, router]);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError('');

    if (!currentPassword) {
      setError(t('changePassword.currentRequired', { defaultValue: 'Please enter your current password' }));
      return;
    }

    const pwCheck = validatePassword(newPassword);
    if (!pwCheck.valid) { setError(pwCheck.error); return; }

    if (newPassword !== confirmPassword) {
      setError(t('auth.toast.passwordsNoMatch'));
      return;
    }

    if (newPassword === currentPassword) {
      setError(t('changePassword.sameAsCurrent', { defaultValue: 'New password must differ from your current password' }));
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      toast(t('changePassword.success', { defaultValue: 'Password changed. Other sessions have been signed out.' }));
      router.replace('/profile');
    } catch (err: unknown) {
      setError(getApiError(err, t('changePassword.failed', { defaultValue: 'Could not change password. Please try again.' })));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading || !user) {
    return <div className="min-h-screen bg-jadwal-bg" aria-hidden />;
  }

  return (
    <div className="min-h-screen bg-jadwal-bg">
      <div className="mx-auto w-full max-w-md px-5 py-8 sm:py-12">
        <Link
          href="/profile"
          className="inline-flex items-center gap-2 text-sm text-jadwal-text-muted hover:text-jadwal-text mb-6 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('common.back', { defaultValue: 'Back' })}
        </Link>

        <div className="rounded-2xl border border-jadwal-border-subtle bg-jadwal-surface p-6 sm:p-8 shadow-sm">
          <h1 className="text-xl font-bold text-jadwal-text mb-1">
            {t('changePassword.title', { defaultValue: 'Change Password' })}
          </h1>
          <p className="text-sm text-jadwal-text-muted mb-6">
            {t('changePassword.subtitle', {
              defaultValue: 'Enter your current password and choose a new one. Other devices will be signed out.',
            })}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="cp-current" className="text-sm font-medium text-jadwal-text-muted ms-0.5">
                {t('changePassword.currentPassword', { defaultValue: 'Current password' })}
              </label>
              <div className="relative">
                <input
                  id="cp-current"
                  name="currentPassword"
                  type={showCurrent ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  maxLength={128}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-4 py-3 pe-12 bg-jadwal-surface-muted border border-jadwal-border-subtle rounded-xl text-sm text-jadwal-text outline-none focus:border-jadwal-accent focus:ring-1 focus:ring-jadwal-accent transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent((v) => !v)}
                  aria-label={showCurrent
                    ? t('changePassword.hideCurrent', { defaultValue: 'Hide current password' })
                    : t('changePassword.showCurrent', { defaultValue: 'Show current password' })}
                  className="absolute inset-e-3 top-1/2 -translate-y-1/2 text-jadwal-text-muted hover:text-jadwal-text cursor-pointer"
                >
                  {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cp-new" className="text-sm font-medium text-jadwal-text-muted ms-0.5">
                {t('changePassword.newPassword', { defaultValue: 'New password' })}
              </label>
              <div className="relative">
                <input
                  id="cp-new"
                  name="newPassword"
                  type={showNew ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  placeholder={t('auth.passwordHint')}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-3 pe-12 bg-jadwal-surface-muted border border-jadwal-border-subtle rounded-xl text-sm text-jadwal-text outline-none focus:border-jadwal-accent focus:ring-1 focus:ring-jadwal-accent transition-all placeholder:text-jadwal-text-muted/50"
                />
                <button
                  type="button"
                  onClick={() => setShowNew((v) => !v)}
                  aria-label={showNew
                    ? t('changePassword.hideNew', { defaultValue: 'Hide new password' })
                    : t('changePassword.showNew', { defaultValue: 'Show new password' })}
                  className="absolute inset-e-3 top-1/2 -translate-y-1/2 text-jadwal-text-muted hover:text-jadwal-text cursor-pointer"
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cp-confirm" className="text-sm font-medium text-jadwal-text-muted ms-0.5">
                {t('auth.confirmPassword')}
              </label>
              <input
                id="cp-confirm"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 bg-jadwal-surface-muted border border-jadwal-border-subtle rounded-xl text-sm text-jadwal-text outline-none focus:border-jadwal-accent focus:ring-1 focus:ring-jadwal-accent transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-all active:scale-[0.98] disabled:opacity-50 shadow-lg shadow-blue-600/25"
            >
              {isSubmitting
                ? t('changePassword.saving', { defaultValue: 'Saving…' })
                : t('changePassword.submit', { defaultValue: 'Change password' })}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
