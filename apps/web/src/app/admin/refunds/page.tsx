'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { sanitize } from '@/lib/validation';
import { useToast } from '@/components/toast';
import AdminLayout from '../_components/admin-layout';
import { Undo2, AlertTriangle, CheckCircle2, XCircle, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Admin refund queue — a focused view of every booking waiting on a refund
 * decision (`payment.status = 'REFUND_PENDING'`). Customers initiate the
 * refund by cancelling a paid booking; vendors / admins record the final
 * decision here.
 *
 * Complementary to `/admin/bookings` (which shows every booking): this page
 * is the at-a-glance queue the team works through. Uses the same server
 * endpoint (`GET /admin/bookings?paymentStatus=REFUND_PENDING`) and the
 * same decision endpoint (`POST /bookings/:id/refund-decision`) so the
 * approval math stays in one place.
 */

interface Booking {
  id: string;
  ref: string;
  totalPrice: string;
  currencyCode: string;
  startDatetime: string;
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  cancelledAt: string | null;
  cancelledBy: 'CUSTOMER' | 'VENDOR' | 'ADMIN' | 'SYSTEM' | null;
  customer: { id: string; fullName: string; email: string };
  activity: { titleEn: string };
  vendor: { businessNameEn: string };
  payment: { id: string; amount: string; status: string; refundAmount: string | null } | null;
}

interface Response {
  data: Booking[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export default function AdminRefundQueuePage() {
  const [page, setPage] = useState(1);
  const [decisionModal, setDecisionModal] = useState<{ booking: Booking; action: 'APPROVE' | 'REJECT' } | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<Response>({
    queryKey: ['admin', 'refunds', page],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
        paymentStatus: 'REFUND_PENDING',
      });
      const { data } = await api.get(`/admin/bookings?${params}`);
      return data;
    },
    staleTime: 30_000,
  });

  const decisionMutation = useMutation({
    mutationFn: async ({ bookingId, action, amount, note }: {
      bookingId: string;
      action: 'APPROVE' | 'REJECT';
      amount?: number;
      note?: string;
    }) => {
      await api.post(`/bookings/${bookingId}/refund-decision`, { action, amount, note });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'refunds'] });
      // Also invalidate the main bookings page cache since the row moves out of REFUND_PENDING.
      queryClient.invalidateQueries({ queryKey: ['admin', 'bookings'] });
      toast(variables.action === 'APPROVE' ? 'Refund recorded' : 'Refund rejected');
      setDecisionModal(null);
      setAmountInput('');
      setNoteInput('');
    },
    onError: (err) => { toast(getApiError(err, 'Failed to record decision'), 'error'); },
  });

  const openApprove = (b: Booking) => {
    const paid = b.payment ? Number(b.payment.amount) : Number(b.totalPrice);
    const suggested = b.payment?.refundAmount ? Number(b.payment.refundAmount) : paid;
    setDecisionModal({ booking: b, action: 'APPROVE' });
    setAmountInput(String(suggested));
    setNoteInput('');
  };

  const openReject = (b: Booking) => {
    setDecisionModal({ booking: b, action: 'REJECT' });
    setAmountInput('');
    setNoteInput('');
  };

  const confirmDecision = () => {
    if (!decisionModal) return;
    const paid = decisionModal.booking.payment
      ? Number(decisionModal.booking.payment.amount)
      : Number(decisionModal.booking.totalPrice);
    // Client-side sanitize belt-and-suspenders — backend SanitizePipe also scrubs.
    const cleanNote = noteInput.trim() ? sanitize(noteInput.trim()).slice(0, 1000) : undefined;
    if (decisionModal.action === 'APPROVE') {
      const amt = Number(amountInput);
      if (!Number.isFinite(amt) || amt < 0) { toast('Enter a valid non-negative amount', 'error'); return; }
      if (amt > paid) { toast(`Amount cannot exceed the paid amount (${paid})`, 'error'); return; }
      decisionMutation.mutate({ bookingId: decisionModal.booking.id, action: 'APPROVE', amount: amt, note: cleanNote });
    } else {
      decisionMutation.mutate({ bookingId: decisionModal.booking.id, action: 'REJECT', note: cleanNote });
    }
  };

  const bookings = data?.data ?? [];

  return (
    <AdminLayout title="Refund Queue" subtitle="Bookings cancelled by customers awaiting a refund decision.">
      <div className="space-y-6">
        {/* Summary row */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 grid place-items-center">
            <Undo2 className="h-5 w-5" />
          </div>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            Vendor sees the same queue at <code className="font-mono text-xs">/vendor/&lt;slug&gt;/refund-requests</code>. Admins can override any decision from here.
          </p>
          {!isLoading && data && (
            <div className="ms-auto text-sm tabular-nums text-gray-500 dark:text-slate-400">
              {data.total} pending
            </div>
          )}
        </div>

        {/* Body */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 bg-gray-100 dark:bg-slate-800/60 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : bookings.length === 0 ? (
          <div className="text-center py-16 rounded-xl border border-dashed border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-500" />
            <p className="mt-3 text-gray-700 dark:text-slate-200 font-medium">No pending refunds</p>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Every cancellation has been resolved.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {bookings.map((b) => {
              const paid = b.payment ? Number(b.payment.amount) : Number(b.totalPrice);
              const suggested = b.payment?.refundAmount ? Number(b.payment.refundAmount) : null;
              return (
                <div key={b.id} className="rounded-xl border border-amber-200/80 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-900/10 p-4">
                  <div className="flex items-start gap-4">
                    <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900 dark:text-white">{b.ref}</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">·</span>
                        <span className="text-sm text-gray-700 dark:text-slate-200 truncate">{b.activity.titleEn}</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">·</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400 wrap-break-word min-w-0">{b.vendor.businessNameEn}</span>
                      </div>
                      <div className="mt-1 text-sm text-gray-600 dark:text-slate-300">
                        <span className="font-medium">{b.customer.fullName}</span>
                        <span className="text-gray-400 dark:text-slate-500"> · {b.customer.email}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-xs text-gray-600 dark:text-slate-400">
                        <div><span className="text-gray-400 dark:text-slate-500">Paid:</span> <span className="tabular-nums">{b.currencyCode} {paid.toFixed(2)}</span></div>
                        <div><span className="text-gray-400 dark:text-slate-500">Suggested:</span> <span className="tabular-nums">{suggested !== null ? `${b.currencyCode} ${suggested.toFixed(2)}` : '—'}</span></div>
                        <div><span className="text-gray-400 dark:text-slate-500">Start:</span> {new Date(b.startDatetime).toLocaleDateString()}</div>
                        <div><span className="text-gray-400 dark:text-slate-500">Cancelled:</span> {b.cancelledAt ? new Date(b.cancelledAt).toLocaleDateString() : '—'}{b.cancelledBy ? ` (${b.cancelledBy.toLowerCase()})` : ''}</div>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openReject(b)}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/40"
                      >
                        No Refund
                      </button>
                      <button
                        type="button"
                        onClick={() => openApprove(b)}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        Record Refund
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between gap-4 text-sm">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-slate-200 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </button>
            <span className="text-gray-500 dark:text-slate-400 tabular-nums">
              Page {data.page} of {data.totalPages}
            </span>
            <button
              type="button"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-slate-200 disabled:opacity-40"
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Decision modal */}
      {decisionModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className={`h-11 w-11 rounded-xl grid place-items-center ${decisionModal.action === 'APPROVE' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'}`}>
                {decisionModal.action === 'APPROVE' ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {decisionModal.action === 'APPROVE' ? 'Record refund' : 'Reject refund'}
                </h2>
                <p className="text-xs text-gray-500 dark:text-slate-400">{decisionModal.booking.ref} · {decisionModal.booking.customer.fullName}</p>
              </div>
            </div>

            {decisionModal.action === 'APPROVE' && (
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Refund amount ({decisionModal.booking.currencyCode})</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                  Paid: {decisionModal.booking.currencyCode} {(decisionModal.booking.payment ? Number(decisionModal.booking.payment.amount) : Number(decisionModal.booking.totalPrice)).toFixed(2)}
                </p>
              </div>
            )}

            <div className="mb-5">
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Note (optional)</label>
              <textarea
                rows={3}
                maxLength={1000}
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                placeholder={decisionModal.action === 'APPROVE' ? 'Reason for amount, if not full refund' : 'Reason for rejecting'}
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setDecisionModal(null); setAmountInput(''); setNoteInput(''); }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDecision}
                disabled={decisionMutation.isPending}
                className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${decisionModal.action === 'APPROVE' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'} disabled:opacity-60 flex items-center gap-2`}
              >
                {decisionMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
