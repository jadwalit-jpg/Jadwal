'use client';

/** Per-section error boundary for /explore/* — see admin/error.tsx for rationale. */
export default function ExploreError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
        Couldn&apos;t load this listing
      </h2>
      <p className="mb-4 max-w-md text-sm text-gray-500 dark:text-slate-400">
        Something went wrong while loading these results. Try again, or browse a different category.
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
