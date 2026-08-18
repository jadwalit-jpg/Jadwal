'use client';

/**
 * Root-level error boundary — catches runtime errors in any page that has no
 * closer segment `error.tsx` (e.g. `/`, `/offers`, `/about`, `/contact`,
 * `/terms`, `/privacy`, auth pages). Renders INSIDE the root layout, so the
 * navbar/footer stay; only the page body is replaced (unlike global-error,
 * which replaces the whole document). Bilingual via i18n with English
 * fallbacks so it stays correct even if the failure is i18n-adjacent.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    // Surface in dev; in prod the error is already reported by the framework /
    // Sentry. Never render error.message to the user (may leak internals).
    if (process.env.NODE_ENV === 'development') console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-red-50 dark:bg-red-900/20 mb-5">
        <AlertTriangle className="h-8 w-8 text-red-500" aria-hidden="true" />
      </div>
      <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">
        {t('error.title', 'Something went wrong')}
      </h1>
      <p className="mb-6 max-w-md text-sm text-gray-500 dark:text-slate-400">
        {t('error.message', 'An unexpected error occurred. You can try again, or head back to the home page.')}
      </p>
      {error.digest && (
        <p className="mb-6 text-xs text-gray-400 dark:text-slate-500">
          {t('error.reference', 'Reference')}: <span className="font-mono tabular-nums">{error.digest}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-xl bg-[#1d4f35] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#173f2a] cursor-pointer"
        >
          <RotateCcw className="h-4 w-4" />
          {t('error.tryAgain', 'Try again')}
        </button>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-slate-700 px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-200 transition-colors hover:bg-gray-100 dark:hover:bg-slate-800"
        >
          <Home className="h-4 w-4" />
          {t('error.goHome', 'Go home')}
        </Link>
      </div>
    </div>
  );
}
