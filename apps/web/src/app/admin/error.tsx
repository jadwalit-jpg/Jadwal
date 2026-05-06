'use client';

/**
 * Per-section error boundary for /admin/*.
 *
 * Catches uncaught render errors in the admin route tree without
 * unmounting the root layout — keeps the navbar, theme, i18n, and
 * auth providers intact while we let the user retry.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
        Admin section error
      </h2>
      <p className="mb-4 max-w-md text-sm text-gray-500 dark:text-slate-400">
        We hit an unexpected error loading this admin page. Try again, or refresh the browser if the problem persists.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
      >
        Try again
      </button>
    </div>
  );
}
