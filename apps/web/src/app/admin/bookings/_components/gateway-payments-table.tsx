'use client';

/**
 * "Gateway payments to check": PAY2M baskets the gateway reported (a held
 * debit-card success, or a success-looking callback that did not verify) that
 * the site never confirmed. Matches what the PAY2M dashboard shows (basket id,
 * amount, time) so the admin can compare, then "Mark as paid". The booking may
 * be pending, cancelled by the customer, or expired (deleted by the cleanup,
 * re-created on confirm).
 */
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

export interface GatewayPaymentRow {
  id: string;
  amount: string | number;
  currency: string;
  status: string;
  basketId: string | null;
  createdAt: string;
  napsHeldAt: string | null;
  unverifiedCallbackAt: string | null;
  unverifiedCallbackErrCode: string | null;
  alertedAt: string | null;
  booking: {
    id: string | null;
    ref: string | null;
    status: string;
    exists: boolean;
    startDatetime: string | null;
    endDatetime: string | null;
    cancelledBy: string | null;
  } | null;
  customer: { fullName: string; email: string; phone: string | null } | null;
  activityTitle: string | null;
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export function gatewayReportText(row: Pick<GatewayPaymentRow, 'napsHeldAt' | 'unverifiedCallbackAt' | 'unverifiedCallbackErrCode'>): string {
  if (row.napsHeldAt) return `Held since ${fmt(row.napsHeldAt)} · awaiting bank confirmation`;
  const code = row.unverifiedCallbackErrCode ? ` code ${row.unverifiedCallbackErrCode}` : '';
  return `Callback${code} at ${fmt(row.unverifiedCallbackAt)} · signature not verified`;
}

export function bookingStateText(booking: GatewayPaymentRow['booking']): string {
  if (!booking) return 'No booking';
  if (!booking.exists) return 'Expired (deleted by the cleanup)';
  if (booking.status === 'CANCELLED') return `Cancelled by ${(booking.cancelledBy ?? 'unknown').toLowerCase()}`;
  return booking.status.charAt(0) + booking.status.slice(1).toLowerCase();
}

export function GatewayPaymentsTable({
  rows,
  pending,
  onMarkPaid,
}: {
  rows: GatewayPaymentRow[];
  pending: boolean;
  onMarkPaid: (row: GatewayPaymentRow) => void;
}) {
  return (
    <div className="rounded-2xl border border-amber-200/80 dark:border-amber-800/60 bg-white dark:bg-slate-900/50 overflow-hidden" data-testid="gateway-payments">
      <div className="flex items-start gap-3 px-6 py-4 border-b border-amber-200/60 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-900/10">
        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-300">Gateway payments to check</p>
          <p className="text-xs text-amber-800 dark:text-amber-400 mt-0.5">
            PAY2M reported these payments but the site could not confirm them. Compare each basket with the PAY2M dashboard; if the money was taken, use Mark as paid.
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-slate-800">
              {['Ref', 'Customer', 'Activity', 'Date', 'Amount', 'Gateway', 'Booking', ''].map((h, i) => (
                <th key={i} className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-6 py-12 text-center text-gray-400 dark:text-slate-500">Nothing to check: every gateway payment of the last 60 days is confirmed.</td></tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} data-testid="gateway-payment-row" className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30">
                <td className="px-6 py-4">
                  <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-1 rounded-md">{row.booking?.ref ?? '—'}</span>
                  <p className="mt-1 font-mono text-[11px] text-gray-400 dark:text-slate-500 break-all">Basket {row.basketId ?? '—'}</p>
                </td>
                <td className="px-6 py-4">
                  <p className="font-medium text-gray-900 dark:text-white">{row.customer?.fullName ?? '—'}</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500">{row.customer?.phone ?? row.customer?.email ?? ''}</p>
                </td>
                <td className="px-6 py-4 text-gray-700 dark:text-slate-300 max-w-[220px] wrap-break-word">{row.activityTitle ?? '—'}</td>
                <td className="px-6 py-4 text-xs text-gray-500 dark:text-slate-400">
                  {row.booking?.startDatetime ? new Date(row.booking.startDatetime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—'}
                </td>
                <td className="px-6 py-4 font-medium text-gray-900 dark:text-white whitespace-nowrap">{row.currency} {Number(row.amount).toLocaleString()}</td>
                <td className="px-6 py-4 text-xs text-amber-700 dark:text-amber-400">{gatewayReportText(row)}</td>
                <td className="px-6 py-4 text-xs text-gray-600 dark:text-slate-300">{bookingStateText(row.booking)}</td>
                <td className="px-6 py-4 text-end">
                  <button
                    type="button"
                    onClick={() => onMarkPaid(row)}
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 shadow-sm whitespace-nowrap"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Mark as paid
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
