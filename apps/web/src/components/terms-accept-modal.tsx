'use client';

import { useState } from 'react';
import { LocaleLink as Link } from '@/components/locale-link';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { useToast } from '@/components/toast';
import { useMountTransition } from '@/lib/use-mount-transition';
import { cn } from '@/lib/utils';

/** Must match the `duration-200` below, or the modal is cut off mid-exit. */
const TRANSITION_MS = 200;

interface Props {
  /** Show the modal. */
  open: boolean;
  /** Called AFTER consent is recorded server-side (and auth refreshed). */
  onAccepted: () => void;
  /** Called when the user cancels / dismisses without accepting. */
  onCancel: () => void;
}

/**
 * Action-time Terms gate — a focused, contextual popup shown the moment a
 * logged-in user who hasn't accepted the current Terms tries to do something
 * that needs consent (e.g. clicks "Book now"). Accepting records consent via
 * POST /auth/accept-terms, refreshes auth, then proceeds; Cancel backs out.
 *
 * This is the friendly hard gate at the decision point. The server
 * (TermsAcceptedGuard) remains the real boundary — this just surfaces the
 * requirement before the user reaches the booking page, instead of after.
 */
export default function TermsAcceptModal({ open, onAccepted, onCancel }: Props) {
  const { t } = useTranslation();
  const { checkAuth } = useAuth();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  // CSS transitions instead of <AnimatePresence>. This modal was the ONLY thing
  // importing framer-motion into the /activity/[slug] route — and because
  // /explore prefetches every activity link, that pulled 117 KB onto the browse
  // page too, where Lighthouse reported it ~90% unused.
  const { mounted, visible } = useMountTransition(open, TRANSITION_MS);

  const accept = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await api.post('/auth/accept-terms');
      await checkAuth();
      onAccepted();
    } catch (e) {
      toast(getApiError(e, t('auth.termsGate.failed', 'Could not record your acceptance. Please try again.')), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!mounted) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm font-outfit',
        'transition-opacity duration-200 ease-out motion-reduce:transition-none',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onCancel(); }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={cn(
          'w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-2xl p-6 text-start',
          'transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none',
          visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-3',
        )}
      >
        <div className="flex items-center justify-center h-12 w-12 rounded-2xl bg-[#1d4f35]/10 dark:bg-emerald-400/10 mb-4">
          <ShieldCheck className="h-6 w-6 text-[#1d4f35] dark:text-emerald-400" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          {t('auth.termsGate.modalTitle', 'Accept our Terms to continue')}
        </h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
          {t('auth.termsGate.modalBody', 'To continue, please accept our')}{' '}
          <Link href="/terms" target="_blank" className="underline text-[#1d4f35] dark:text-emerald-400 font-medium">{t('terms.title')}</Link>
          {' '}{t('auth.and')}{' '}
          <Link href="/privacy" target="_blank" className="underline text-[#1d4f35] dark:text-emerald-400 font-medium">{t('privacy.title')}</Link>.
        </p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            {t('auth.termsGate.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={accept}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1d4f35] hover:bg-[#163e29] text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('auth.termsGate.accept', 'Accept')}
          </button>
        </div>
      </div>
    </div>
  );
}
