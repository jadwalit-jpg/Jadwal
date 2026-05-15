'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, X, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';

/* ─── Props ────────────────────────────────────────────────────
 *
 * Modal is OWNED by the booking detail page (/bookings/[id]). The page
 * decides when to show/hide based on booking.status === 'PENDING' AND
 * booking.emailOtpVerifiedAt === null.
 *
 * `bookingId` is the UUID of the booking to verify against. Re-mounting
 * the modal with a different bookingId resets internal state.
 *
 * `onVerified` fires once the backend returns 200 from /verify-email-otp.
 * The page should then re-fetch the booking + close this modal.
 */
interface BookingEmailOtpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVerified: () => void;
  bookingId: string;
  /** Customer's email (already masked or full) for "we sent it to X" copy. */
  emailHint?: string;
}

const RESEND_COOLDOWN_SEC = 30;

export function BookingEmailOtpModal({
  isOpen,
  onClose,
  onVerified,
  bookingId,
  emailHint,
}: BookingEmailOtpModalProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state every time the modal opens. Auto-focus the input.
  useEffect(() => {
    if (isOpen) {
      setCode('');
      setError('');
      setResendCooldown(RESEND_COOLDOWN_SEC);
      // Defer focus until the modal is in the DOM after AnimatePresence runs.
      const id = window.setTimeout(() => inputRef.current?.focus(), 100);
      return () => window.clearTimeout(id);
    }
  }, [isOpen]);

  // Resend cooldown ticker.
  useEffect(() => {
    if (!isOpen || resendCooldown <= 0) return;
    const id = window.setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [isOpen, resendCooldown]);

  // Verify submission. Called via Enter, Verify button, or auto-submit on 6 chars.
  const handleVerify = useCallback(
    async (codeToSubmit: string) => {
      if (verifying) return;
      if (!/^[0-9]{6}$/.test(codeToSubmit)) {
        setError(t('booking.emailOtp.invalidCode'));
        return;
      }
      setVerifying(true);
      setError('');
      try {
        await api.post(`/bookings/${bookingId}/verify-email-otp`, { code: codeToSubmit });
        onVerified();
      } catch (err: unknown) {
        setError(getApiError(err, t('booking.emailOtp.invalidCode')));
        // Clear the field so the customer can re-type without backspacing.
        setCode('');
        inputRef.current?.focus();
      } finally {
        setVerifying(false);
      }
    },
    [bookingId, onVerified, t, verifying],
  );

  const handleResend = useCallback(async () => {
    if (resendCooldown > 0 || resending) return;
    setResending(true);
    setError('');
    try {
      await api.post(`/bookings/${bookingId}/send-email-otp`);
      setResendCooldown(RESEND_COOLDOWN_SEC);
      // Surface success as a transient state — show the success copy in
      // the error slot (repurposed as "info"). Clears on next interaction.
      setError(t('booking.emailOtp.resendSent'));
    } catch (err: unknown) {
      setError(getApiError(err, t('booking.emailOtp.resendFailed')));
    } finally {
      setResending(false);
    }
  }, [bookingId, resendCooldown, resending, t]);

  // Numeric-only input. Auto-submit when the 6th digit lands.
  const handleChange = useCallback(
    (raw: string) => {
      // Strip everything except digits. Cap at 6.
      const digits = raw.replace(/[^0-9]/g, '').slice(0, 6);
      setCode(digits);
      setError('');
      if (digits.length === 6) {
        // Defer to next tick so the input state reflects the final value
        // (avoids race with React batching).
        window.setTimeout(() => handleVerify(digits), 0);
      }
    },
    [handleVerify],
  );

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 w-full max-w-md mx-4 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-6 pb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-blue-100 dark:bg-blue-900/30">
                <Mail className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {t('booking.emailOtp.title')}
                </h3>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  {emailHint
                    ? t('booking.emailOtp.description') + ' (' + emailHint + ')'
                    : t('booking.emailOtp.description')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition cursor-pointer"
              aria-label="Close"
            >
              <X className="h-5 w-5 text-gray-400" />
            </button>
          </div>

          <div className="px-6 pb-6 pt-4">
            {error && (
              <div className="mb-4 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 text-sm text-blue-700 dark:text-blue-400">
                {error}
              </div>
            )}

            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
              {t('booking.emailOtp.codeLabel')}
            </label>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.length === 6) handleVerify(code);
              }}
              placeholder={t('booking.emailOtp.codePlaceholder')}
              disabled={verifying}
              className="w-full px-4 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-center text-xl font-mono tracking-[0.5em] text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-slate-600 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all disabled:opacity-50"
            />
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-2 text-center">
              {t('booking.emailOtp.checkSpam')}
            </p>

            <button
              type="button"
              onClick={() => handleVerify(code)}
              disabled={code.length !== 6 || verifying}
              className="w-full mt-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {verifying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('booking.emailOtp.verifying')}
                </>
              ) : (
                t('booking.emailOtp.verifyCta')
              )}
            </button>

            <button
              type="button"
              onClick={handleResend}
              disabled={resendCooldown > 0 || resending}
              className="w-full mt-2 py-2.5 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resendCooldown > 0
                ? t('booking.emailOtp.resendIn', { seconds: resendCooldown })
                : t('booking.emailOtp.resendCta')}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
