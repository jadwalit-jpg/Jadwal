'use client';

/**
 * Bottom-anchored cookie-consent banner. Shows once, until the visitor
 * Accepts or Declines; the choice gates the Meta Pixel (see <MetaPixel>).
 * Bilingual via i18n; RTL-safe (logical properties); dark-mode aware.
 */

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Cookie } from 'lucide-react';
import { useCookieConsent } from '@/context/cookie-consent';

export default function CookieConsentBanner() {
  const { consent, hydrated, accept, decline } = useCookieConsent();
  const { t } = useTranslation();

  const show = hydrated && consent === null;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 120, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 120, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 28 }}
          role="dialog"
          aria-live="polite"
          aria-label={t('cookies.title')}
          className="fixed bottom-4 inset-x-4 z-[200] mx-auto max-w-3xl rounded-2xl border border-jadwal-border-subtle bg-jadwal-surface/95 p-5 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-6 md:flex md:items-center md:gap-5"
        >
          <div className="flex flex-1 items-start gap-3">
            <Cookie aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0 text-jadwal-accent" />
            <p className="text-sm leading-relaxed text-jadwal-text-muted text-start">
              {t('cookies.message')}{' '}
              <Link href="/privacy" className="font-semibold text-jadwal-accent hover:underline">
                {t('cookies.learnMore')}
              </Link>
            </p>
          </div>
          <div className="mt-4 flex shrink-0 gap-3 md:mt-0">
            <button
              type="button"
              onClick={decline}
              className="flex-1 rounded-full border border-jadwal-border-subtle px-5 py-2.5 text-sm font-semibold text-jadwal-text-muted transition-colors hover:bg-jadwal-bg md:flex-none"
            >
              {t('cookies.decline')}
            </button>
            <button
              type="button"
              onClick={accept}
              className="flex-1 rounded-full bg-jadwal-accent px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 md:flex-none"
            >
              {t('cookies.accept')}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
