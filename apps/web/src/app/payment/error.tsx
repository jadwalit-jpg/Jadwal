'use client';

/**
 * Per-section error boundary for /payment/*.
 *
 * IMPORTANT: this only catches RENDER errors (React component errors).
 * Payment confirmation correctness is owned by the API + PAY2M callbacks
 * (idempotent, signature-verified, optimistic-locked) — a render error
 * here doesn't risk double-charging or corrupting the order.
 */
export default function PaymentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
        Payment page error
      </h2>
      <p className="mb-4 max-w-md text-sm text-gray-500 dark:text-slate-400">
        We couldn&apos;t render this payment page. Your booking and any in-flight payment status are unaffected. Try again, or check &quot;My Bookings&quot; to see the latest state.
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
