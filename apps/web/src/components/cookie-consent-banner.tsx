'use client';

/**
 * Bottom-anchored cookie-consent banner. Shows once, until the visitor
 * Accepts or Declines; the choice gates the Meta Pixel (see <MetaPixel>).
 * Bilingual via i18n; RTL-safe (logical properties); dark-mode aware.
 *
 * The slide-up is a CSS transition, NOT framer-motion. This component and
 * <TermsConsentGate> are rendered by the root layout, so importing an
 * animation library here put 120 KB of `motion-dom` + `framer-motion` into the
 * critical chunk group of every route for one fade-and-slide. See
 * `useMountTransition` for how the exit transition works without
 * <AnimatePresence>. Translate is on the Y axis only, so this stays RTL-safe.
 */

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Cookie } from 'lucide-react';
import { useCookieConsent } from '@/context/cookie-consent';
import { useMountTransition } from '@/lib/use-mount-transition';
import { cn } from '@/lib/utils';

/** Must match the `duration-300` below, or the banner is cut off mid-exit. */
const TRANSITION_MS = 300;

export default function CookieConsentBanner() {
  const { bannerOpen, accept, decline } = useCookieConsent();
  const { t } = useTranslation();

  // `bannerOpen` covers both cases: never decided, or re-opened from the footer
  // to change an earlier decision (the PDPPL right to withdraw consent).
  const { mounted, visible } = useMountTransition(bannerOpen, TRANSITION_MS);

  if (!mounted) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t('cookies.title')}
      className={cn(
        'fixed bottom-4 inset-x-4 z-[200] mx-auto max-w-3xl rounded-2xl border border-jadwal-border-subtle bg-jadwal-surface/95 p-5 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-6 md:flex md:items-center md:gap-5',
        'transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-32 opacity-0 pointer-events-none',
      )}
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
    </div>
  );
}
