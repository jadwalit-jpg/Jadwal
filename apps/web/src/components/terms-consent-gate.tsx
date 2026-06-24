'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, X, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { useToast } from '@/components/toast';

const DISMISS_KEY = 'jadwal_terms_banner_dismissed';

/**
 * Soft, NON-blocking Terms-consent prompt — a dismissible bottom corner banner
 * shown to a logged-in customer/vendor who hasn't accepted the current Terms
 * (Google-OAuth signups, pre-feature accounts, version bumps). It does NOT lock
 * the app: the user can browse, like, and read the linked Terms/Privacy pages.
 *
 * The HARD gate lives elsewhere — the booking/checkout step requires consent
 * inline, and the server (TermsAcceptedGuard) rejects booking/payment/listing
 * with 403 until it's recorded. So this banner is a gentle nudge, not the
 * security boundary. Dismiss hides it for the browser session; admins excluded.
 */
export default function TermsConsentGate() {
  const { user, checkAuth } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  // Start hidden until we've read sessionStorage (prevents a flash before the
  // dismissed state is known) — flipped in the effect below.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  const show = !!user && user.role !== 'ADMIN' && !!user.needsTermsAcceptance && !dismissed;

  const accept = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await api.post('/auth/accept-terms');
      await checkAuth(); // needsTermsAcceptance flips false → banner unmounts
      toast(t('auth.termsGate.accepted', 'Thanks — you can now book.'), 'success');
    } catch (e) {
      toast(getApiError(e, t('auth.termsGate.failed', 'Could not record your acceptance. Please try again.')), 'error');
      setSubmitting(false);
    }
  };

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode — fall back to in-memory */ }
    setDismissed(true);
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-4 end-4 z-50 w-[min(92vw,22rem)] font-outfit"
          role="status"
        >
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-xl shadow-black/10 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 shrink-0 text-[#1d4f35] dark:text-emerald-400 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900 dark:text-white text-start">
                  {t('auth.termsGate.bannerTitle', 'Review our Terms')}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400 text-start">
                  {t('auth.termsGate.bannerBody', 'Browse freely — to book, please accept our')}{' '}
                  <Link href="/terms" target="_blank" className="underline text-[#1d4f35] dark:text-emerald-400">{t('terms.title')}</Link>
                  {' '}{t('auth.and')}{' '}
                  <Link href="/privacy" target="_blank" className="underline text-[#1d4f35] dark:text-emerald-400">{t('privacy.title')}</Link>.
                </p>
                <button
                  type="button"
                  onClick={accept}
                  disabled={submitting}
                  className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1d4f35] hover:bg-[#163e29] text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('auth.termsGate.accept', 'Accept')}
                </button>
              </div>
              <button
                type="button"
                onClick={dismiss}
                aria-label={t('auth.termsGate.dismiss', 'Dismiss')}
                className="shrink-0 -me-1 -mt-1 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
