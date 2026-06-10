'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { CheckCircle, XCircle, Loader2, Clock } from 'lucide-react';
import Link from 'next/link';

function CallbackContent() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();

  const status = searchParams.get('status');
  const bookingId = searchParams.get('bookingId');
  const error = searchParams.get('error');

  const isSuccess = status === 'success';
  // 'pending' = the gateway verified the payment message but the capture is
  // still being confirmed (NAPS rail) — not a success yet, NOT a failure.
  const isPending = status === 'pending';

  // Invalidate booking caches so detail page shows updated status
  useEffect(() => {
    if (bookingId) {
      queryClient.invalidateQueries({ queryKey: ['booking', bookingId] });
      queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
    }
  }, [bookingId, queryClient]);

  // Auto-redirect to booking detail after success
  useEffect(() => {
    if (isSuccess && bookingId) {
      const timer = setTimeout(() => router.push(`/bookings/${bookingId}`), 4000);
      return () => clearTimeout(timer);
    }
  }, [isSuccess, bookingId, router]);

  return (
    <div className="min-h-svh bg-gray-50 dark:bg-slate-950 flex items-center justify-center p-6 font-outfit">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-xl p-10 max-w-md w-full text-center"
      >
        {isSuccess ? (
          <>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
              className="w-20 h-20 mx-auto mb-6 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center"
            >
              <CheckCircle className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
            </motion.div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t('payment.success')}</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
              {t('payment.successDesc')}
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-gray-400 dark:text-slate-500 mb-6">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('payment.redirecting')}
            </div>
            {bookingId && (
              <Link
                href={`/bookings/${bookingId}`}
                className="inline-block px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-colors text-sm"
              >
                {t('payment.viewBooking')}
              </Link>
            )}
          </>
        ) : isPending ? (
          <>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
              className="w-20 h-20 mx-auto mb-6 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center"
            >
              <Clock className="h-10 w-10 text-amber-600 dark:text-amber-400" />
            </motion.div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t('payment.pendingTitle')}</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
              {t('payment.pendingDesc')}
            </p>
            <div className="flex flex-col gap-3">
              {bookingId && (
                <Link
                  href={`/bookings/${bookingId}`}
                  className="inline-block px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-xl transition-colors text-sm"
                >
                  {t('payment.viewBooking')}
                </Link>
              )}
              <Link
                href="/bookings"
                className="text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 transition-colors"
              >
                {t('payment.backToBookings')}
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <XCircle className="h-10 w-10 text-red-600 dark:text-red-400" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t('payment.failed')}</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
              {/* React auto-escapes this as text so no XSS is possible, but
                  cap length + strip control chars defensively so a crafted
                  URL can't jam a wall of text into the UI or include bidi
                  overrides that spoof the message direction. */}
              {(() => {
                if (!error) return t('payment.failedDesc');
                try {
                  const decoded = decodeURIComponent(error);
                  const clean = decoded.replace(/[\u0000-\u001F\u2066-\u2069\u202A-\u202E]/g, '');
                  return clean.length > 200 ? `${clean.slice(0, 200)}…` : clean;
                } catch {
                  return t('payment.failedDesc');
                }
              })()}
            </p>
            <div className="flex flex-col gap-3">
              {bookingId && (
                <Link
                  href={`/bookings/${bookingId}`}
                  className="inline-block px-6 py-3 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-xl transition-colors text-sm"
                >
                  {t('payment.tryAgain')}
                </Link>
              )}
              <Link
                href="/bookings"
                className="text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 transition-colors"
              >
                {t('payment.backToBookings')}
              </Link>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

export default function PaymentCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-svh bg-gray-50 dark:bg-slate-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    }>
      <CallbackContent />
    </Suspense>
  );
}
