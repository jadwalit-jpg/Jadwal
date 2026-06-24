'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { useToast } from '@/components/toast';

/**
 * One-time post-login Terms consent gate. Renders a blocking overlay whenever a
 * logged-in customer/vendor hasn't accepted the current Terms version — i.e.
 * Google-OAuth signups (no registration form), accounts created before this
 * feature, or anyone after a TERMS_VERSION bump. Email/password + vendor
 * signups accept at registration, so it never fires for them. Admins (internal
 * staff, never contracting) are excluded.
 *
 * No bypass: the only exits are Accept (records consent) or Sign out. This is
 * UX only — the server independently rejects booking/payment/listing-create
 * until consent is recorded (TermsAcceptedGuard), so the overlay can't be
 * skipped to transact.
 */
export default function TermsConsentGate() {
  const { user, checkAuth, logout } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!user || user.role === 'ADMIN' || !user.needsTermsAcceptance) return null;

  const accept = async () => {
    if (!agreed || submitting) return;
    setSubmitting(true);
    try {
      await api.post('/auth/accept-terms');
      await checkAuth(); // refetch /auth/me → needsTermsAcceptance flips false → overlay unmounts
    } catch (e) {
      toast(getApiError(e, t('auth.termsGate.failed', 'Could not record your acceptance. Please try again.')), 'error');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 font-outfit">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-2xl p-7">
        <div className="flex items-center gap-2.5 mb-3">
          <ShieldCheck className="h-6 w-6 shrink-0 text-[#1d4f35]" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">{t('auth.termsGate.title', 'One more step')}</h2>
        </div>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-5 text-start">
          {t('auth.termsGate.body', 'Please review and accept our Terms and Privacy Policy to continue using Jadwal.')}
        </p>

        <label className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-slate-300 cursor-pointer select-none mb-5">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-[#1d4f35]"
          />
          <span>
            {t('auth.agreeTermsCheckbox', 'I agree to the')}{' '}
            <Link href="/terms" target="_blank" className="underline text-[#1d4f35] dark:text-emerald-400">{t('terms.title')}</Link>
            {' '}{t('auth.and')}{' '}
            <Link href="/privacy" target="_blank" className="underline text-[#1d4f35] dark:text-emerald-400">{t('privacy.title')}</Link>
            {' '}{t('auth.and18Plus', 'and confirm I am 18 or older')}
          </span>
        </label>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={accept}
            disabled={!agreed || submitting}
            className="w-full py-3 rounded-xl bg-[#1d4f35] hover:bg-[#163e29] text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('auth.termsGate.accept', 'Accept & continue')}
          </button>
          <button
            type="button"
            onClick={() => logout()}
            disabled={submitting}
            className="w-full py-2.5 rounded-xl text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
          >
            {t('auth.termsGate.signOut', 'Sign out')}
          </button>
        </div>
      </div>
    </div>
  );
}
