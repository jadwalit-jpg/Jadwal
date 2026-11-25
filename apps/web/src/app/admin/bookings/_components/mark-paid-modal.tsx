'use client';

/**
 * Admin "Mark as paid": confirm a PAY2M payment the site could not confirm by
 * itself. The admin types the PAY2M transaction id and a note; the amount is
 * the payment's own frozen amount and is shown read-only. The server confirms
 * the booking through the normal confirmation path, or refuses (slot taken,
 * already paid, listing inactive…) with a message shown under the form.
 */
import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

export type MarkPaidTarget = {
  paymentId: string;
  ref: string | null;
  amount: string | number;
  currency: string;
  customerName: string | null;
  basketId: string | null;
  /** PENDING / CANCELLED / EXPIRED (deleted by the cleanup) — tells the admin what the confirm does. */
  bookingState: string;
};

export const TXN_MIN = 3;
export const TXN_MAX = 64;
export const NOTE_MIN = 5;
export const NOTE_MAX = 500;
const TXN_PATTERN = /^[A-Za-z0-9._-]+$/;

/** The same rule the API's DTO applies, so the button is only enabled for a request that will validate. */
export function markPaidFormValid(transactionId: string, note: string): boolean {
  const txn = transactionId.trim();
  return txn.length >= TXN_MIN && txn.length <= TXN_MAX && TXN_PATTERN.test(txn) && note.trim().length >= NOTE_MIN && note.trim().length <= NOTE_MAX;
}

/** What confirming does to the booking in its current state. */
export function markPaidEffectText(bookingState: string): string {
  switch (bookingState) {
    case 'CANCELLED':
      return 'The cancelled booking is restored and confirmed, if its slot is still free.';
    case 'EXPIRED':
      return 'The expired booking is re-created from its saved copy and confirmed, if its slot is still free.';
    default:
      return 'The pending booking is confirmed, if its slot is still free.';
  }
}

export function MarkPaidModal({
  target,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  target: MarkPaidTarget;
  pending: boolean;
  error: string | null;
  onConfirm: (paymentId: string, input: { transactionId: string; note: string }) => void;
  onClose: () => void;
}) {
  const [transactionId, setTransactionId] = useState('');
  const [note, setNote] = useState('');
  const valid = markPaidFormValid(transactionId, note);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-mark-paid-title"
        onKeyDown={(e) => { if (e.key === 'Escape' && !pending) onClose(); }}
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 max-w-md w-full"
      >
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <h3 id="admin-mark-paid-title" className="text-lg font-bold text-gray-900 dark:text-white">Mark as paid</h3>
          </div>

          <p className="text-sm text-gray-600 dark:text-slate-400 mb-3">
            Booking <span className="font-mono font-semibold">{target.ref ?? '—'}</span>
            {target.customerName ? <> for <span className="font-semibold">{target.customerName}</span></> : null}.
            {' '}{markPaidEffectText(target.bookingState)}
          </p>

          <dl className="mb-4 rounded-xl border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-800 text-sm">
            <div className="flex items-center justify-between px-3 py-2">
              <dt className="text-gray-500 dark:text-slate-400">Amount (fixed)</dt>
              <dd className="font-semibold text-gray-900 dark:text-white" data-testid="mark-paid-amount">
                {target.currency} {Number(target.amount).toLocaleString()}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 px-3 py-2">
              <dt className="text-gray-500 dark:text-slate-400">PAY2M basket</dt>
              <dd className="font-mono text-xs text-gray-900 dark:text-white truncate" data-testid="mark-paid-basket">{target.basketId ?? '—'}</dd>
            </div>
          </dl>

          <p className="mb-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            Only confirm after checking in the PAY2M dashboard that this basket was paid. The customer and the vendor are notified as for any paid booking.
          </p>

          <div className="mb-4">
            <label htmlFor="mark-paid-txn" className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
              PAY2M transaction ID
            </label>
            <input
              id="mark-paid-txn"
              type="text"
              value={transactionId}
              onChange={(e) => setTransactionId(e.target.value.slice(0, TXN_MAX))}
              placeholder="As shown on the PAY2M dashboard"
              disabled={pending}
              className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-mono"
            />
          </div>
          <div className="mb-4">
            <label htmlFor="mark-paid-note" className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
              Note <span className="text-gray-400 font-normal">(what you checked)</span>
            </label>
            <textarea
              id="mark-paid-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
              rows={3}
              placeholder="e.g. PAY2M shows the basket as paid on 22 Nov 10:12, customer confirmed on WhatsApp"
              disabled={pending}
              className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 resize-none"
            />
            <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">{note.length}/{NOTE_MAX}</p>
          </div>

          {error ? (
            <p role="alert" data-testid="mark-paid-error" className="mb-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 px-3 py-2 text-xs text-red-700 dark:text-red-400">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onConfirm(target.paymentId, { transactionId: transactionId.trim(), note: note.trim() })}
              disabled={pending || !valid}
              className="px-4 py-2 text-sm font-medium text-white rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
            >
              {pending ? 'Confirming…' : 'Confirm payment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
