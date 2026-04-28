'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import api from '@/lib/api';
import { localized } from '@/lib/localize';
import { getApiError } from '@/lib/api-error';
import { sanitize } from '@/lib/validation';
import { useToast } from '@/components/toast';
import { VendorSidebar } from '../../_components/vendor-sidebar';
import {
  Undo2,
  User,
  Mail,
  Phone,
  Calendar,
  Clock,
  CreditCard,
  Tag,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Info,
} from 'lucide-react';

interface RefundRequest {
  id: string;
  ref: string;
  startDatetime: string;
  endDatetime: string;
  guests: number;
  totalPrice: string;
  serviceFee: string;
  commissionPct: string;
  commissionAmount: string;
  couponCode: string | null;
  couponDiscount: string;
  currencyCode: string;
  selectedExtras: { name: string; price: number; perPerson: boolean }[] | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  createdAt: string;
  customer: { id: string; fullName: string; email: string; phone: string | null };
  activity: {
    titleEn: string;
    titleAr: string | null;
    slug: string;
    cancellationPolicy: string | null;
    country: { currencyCode: string } | null;
  };
  payment: {
    id: string;
    amount: string;
    method: string;
    paidAt: string | null;
    refundAmount: string | null;
    gatewayTxnId: string | null;
  } | null;
}

function suggestedRefund(r: RefundRequest, t: TFunction): { amount: number; label: string; reason: string } {
  const paid = r.payment ? Number(r.payment.amount) : Number(r.totalPrice);
  const policy = r.activity.cancellationPolicy ?? 'FREE_CANCELLATION';
  const deadline = 24;
  if (!r.cancelledAt) {
    return {
      amount: paid,
      label: t('vendor.refundRequests.suggested.labelFull', { defaultValue: 'Full refund' }),
      reason: t('vendor.refundRequests.suggested.reasonNoCancelTs', { defaultValue: 'No cancel timestamp' }),
    };
  }
  const hoursBeforeStart =
    (new Date(r.startDatetime).getTime() - new Date(r.cancelledAt).getTime()) / (1000 * 60 * 60);
  const ok = hoursBeforeStart >= deadline;
  const hours = Math.floor(hoursBeforeStart);
  if (policy === 'NON_REFUNDABLE') {
    return {
      amount: 0,
      label: t('vendor.refundRequests.suggested.labelNone', { defaultValue: 'No refund' }),
      reason: t('vendor.refundRequests.suggested.reasonNonRefundable', { defaultValue: 'Non-refundable activity' }),
    };
  }
  if (policy === 'PARTIAL_REFUND') {
    if (ok) {
      return {
        amount: Number((paid * 0.5).toFixed(2)),
        label: t('vendor.refundRequests.suggested.labelHalf', { defaultValue: '50% refund' }),
        reason: t('vendor.refundRequests.suggested.reasonPartialOk', {
          hours,
          defaultValue: `Cancelled ${hours}h before start`,
        }),
      };
    }
    return {
      amount: 0,
      label: t('vendor.refundRequests.suggested.labelNone', { defaultValue: 'No refund' }),
      reason: t('vendor.refundRequests.suggested.reasonPartialLate', {
        deadline,
        defaultValue: `Cancelled less than ${deadline}h before start`,
      }),
    };
  }
  if (ok) {
    return {
      amount: paid,
      label: t('vendor.refundRequests.suggested.labelFull', { defaultValue: 'Full refund' }),
      reason: t('vendor.refundRequests.suggested.reasonFreeOk', {
        hours,
        defaultValue: `Cancelled ${hours}h before start`,
      }),
    };
  }
  return {
    amount: 0,
    label: t('vendor.refundRequests.suggested.labelNone', { defaultValue: 'No refund' }),
    reason: t('vendor.refundRequests.suggested.reasonFreeLate', {
      deadline,
      defaultValue: `Cancelled less than ${deadline}h before start`,
    }),
  };
}

function formatDateTime(iso: string | null, t: TFunction) {
  if (!iso) return t('vendor.refundRequests.dash');
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function timeAgo(iso: string | null, t: TFunction) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) {
    return t('vendor.refundRequests.timeAgo.daysHours', { days, hours });
  }
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) {
    return t('vendor.refundRequests.timeAgo.hoursMinutes', { hours, minutes });
  }
  return t('vendor.refundRequests.timeAgo.minutes', { minutes });
}

function cancellationPolicyLabel(policy: string | null, t: TFunction) {
  const key = policy ?? 'FREE_CANCELLATION';
  return t(`vendor.refundRequests.policy.${key}`, { defaultValue: key });
}

export default function VendorRefundRequestsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [decisionModal, setDecisionModal] = useState<{
    booking: RefundRequest;
    action: 'APPROVE' | 'REJECT';
  } | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [noteInput, setNoteInput] = useState('');

  const { data, isLoading, error } = useQuery<RefundRequest[]>({
    queryKey: ['vendor', 'refund-requests'],
    queryFn: async () => {
      const { data } = await api.get('/vendor/refund-requests');
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 30000,
  });

  const decisionMutation = useMutation({
    mutationFn: async ({
      bookingId,
      action,
      amount,
      note,
    }: {
      bookingId: string;
      action: 'APPROVE' | 'REJECT';
      amount?: number;
      note?: string;
    }) => {
      const { data } = await api.post(`/bookings/${bookingId}/refund-decision`, {
        action,
        amount,
        note,
      });
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vendor', 'refund-requests'] });
      queryClient.invalidateQueries({ queryKey: ['vendor', 'refund-requests-count'] });
      toast(
        variables.action === 'APPROVE'
          ? t('vendor.refundRequests.toast.recordedApprove')
          : t('vendor.refundRequests.toast.recordedReject'),
        'success',
      );
      setDecisionModal(null);
      setAmountInput('');
      setNoteInput('');
    },
    onError: (err) => {
      toast(getApiError(err, t('vendor.refundRequests.toast.decisionFailed')), 'error');
    },
  });

  const openApprove = (r: RefundRequest) => {
    const suggested = suggestedRefund(r, t);
    setDecisionModal({ booking: r, action: 'APPROVE' });
    setAmountInput(String(suggested.amount));
    setNoteInput('');
  };

  const openReject = (r: RefundRequest) => {
    setDecisionModal({ booking: r, action: 'REJECT' });
    setAmountInput('');
    setNoteInput('');
  };

  const confirmDecision = () => {
    if (!decisionModal) return;
    const paid = decisionModal.booking.payment
      ? Number(decisionModal.booking.payment.amount)
      : Number(decisionModal.booking.totalPrice);

    const cleanNote = noteInput.trim() ? sanitize(noteInput.trim()).slice(0, 1000) : undefined;

    if (decisionModal.action === 'APPROVE') {
      const amt = Number(amountInput);
      if (!Number.isFinite(amt) || amt < 0) {
        toast(t('vendor.refundRequests.toast.invalidAmount'), 'error');
        return;
      }
      if (amt > paid) {
        toast(t('vendor.refundRequests.toast.amountExceeds', { max: paid }), 'error');
        return;
      }
      decisionMutation.mutate({
        bookingId: decisionModal.booking.id,
        action: 'APPROVE',
        amount: amt,
        note: cleanNote,
      });
    } else {
      decisionMutation.mutate({
        bookingId: decisionModal.booking.id,
        action: 'REJECT',
        note: cleanNote,
      });
    }
  };

  const requests = useMemo(() => data ?? [], [data]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <VendorSidebar />
      <main className="ps-64">
        <div className="max-w-6xl mx-auto px-6 sm:px-8 lg:px-10 py-10">
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Undo2 className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('vendor.refundRequests.title')}</h1>
              {requests.length > 0 && (
                <span className="inline-flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold px-2.5 py-1">
                  {t('vendor.refundRequests.badgePending', { count: requests.length })}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 dark:text-slate-400 max-w-2xl">{t('vendor.refundRequests.subtitle')}</p>
          </div>

          {isLoading && (
            <div className="space-y-4">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-64 bg-white dark:bg-slate-900/50 rounded-2xl border border-gray-200 dark:border-slate-800 animate-pulse" />
              ))}
            </div>
          )}

          {error && !isLoading && (
            <div className="rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-900/10 p-6 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-red-900 dark:text-red-300">{t('vendor.refundRequests.errorTitle')}</p>
                <p className="text-sm text-red-700 dark:text-red-400 mt-1">
                  {getApiError(error, t('vendor.refundRequests.errorTryAgain'))}
                </p>
              </div>
            </div>
          )}

          {!isLoading && !error && requests.length === 0 && (
            <div className="rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-12 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-4">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t('vendor.refundRequests.emptyTitle')}</h3>
              <p className="text-sm text-gray-500 dark:text-slate-400 mt-2 max-w-md mx-auto">{t('vendor.refundRequests.emptySubtitle')}</p>
            </div>
          )}

          {!isLoading && !error && requests.length > 0 && (
            <div className="space-y-5">
              {requests.map((r) => {
                const suggested = suggestedRefund(r, t);
                const paid = r.payment ? Number(r.payment.amount) : Number(r.totalPrice);
                const currency = r.currencyCode || r.activity.country?.currencyCode || 'QAR';
                return (
                  <div
                    key={r.id}
                    className="rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden shadow-sm"
                  >
                    <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-amber-50/30 dark:bg-amber-900/5">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-2.5 py-1 rounded-md">
                          {r.ref}
                        </span>
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{localized(r.activity, 'title')}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
                        <Clock className="h-3.5 w-3.5" />
                        <span>
                          {t('vendor.refundRequests.cancelledPrefix')} {timeAgo(r.cancelledAt, t)}
                        </span>
                      </div>
                    </div>

                    <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                          <User className="h-3 w-3" /> {t('vendor.refundRequests.sections.customer')}
                        </p>
                        <p className="font-semibold text-gray-900 dark:text-white mb-1.5">{r.customer.fullName}</p>
                        <p className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1 mb-1 break-all">
                          <Mail className="h-3 w-3 shrink-0" /> {r.customer.email}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1">
                          <Phone className="h-3 w-3 shrink-0" /> {r.customer.phone ?? t('vendor.refundRequests.phoneNotProvided')}
                        </p>
                      </div>

                      <div>
                        <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                          <Calendar className="h-3 w-3" /> {t('vendor.refundRequests.sections.scheduledFor')}
                        </p>
                        <p className="font-medium text-gray-900 dark:text-white text-sm">{formatDateTime(r.startDatetime, t)}</p>
                        <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                          {t('vendor.refundRequests.scheduleTo', { datetime: formatDateTime(r.endDatetime, t) })}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-slate-400 mt-2">
                          {r.guests === 1
                            ? t('vendor.refundRequests.guestOne', { count: r.guests })
                            : t('vendor.refundRequests.guestOther', { count: r.guests })}
                        </p>
                      </div>

                      <div>
                        <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {t('vendor.refundRequests.sections.timeline')}
                        </p>
                        <div className="space-y-1">
                          <div>
                            <p className="text-[10px] text-gray-400 dark:text-slate-500">{t('vendor.refundRequests.timelineBooked')}</p>
                            <p className="text-xs text-gray-700 dark:text-slate-300">{formatDateTime(r.createdAt, t)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-gray-400 dark:text-slate-500">{t('vendor.refundRequests.timelineCancelled')}</p>
                            <p className="text-xs text-gray-700 dark:text-slate-300">{formatDateTime(r.cancelledAt, t)}</p>
                          </div>
                        </div>
                      </div>

                      <div>
                        <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                          <CreditCard className="h-3 w-3" /> {t('vendor.refundRequests.sections.payment')}
                        </p>
                        <p className="font-bold text-gray-900 dark:text-white">
                          {paid.toLocaleString()} {currency}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{r.payment?.method ?? t('vendor.refundRequests.na')}</p>
                        {r.payment?.paidAt && (
                          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                            {t('vendor.refundRequests.paidAt', { datetime: formatDateTime(r.payment.paidAt, t) })}
                          </p>
                        )}
                        {r.payment?.gatewayTxnId && (
                          <p className="text-[10px] text-gray-400 dark:text-slate-500 font-mono mt-1 truncate">
                            {t('vendor.refundRequests.txn', { id: r.payment.gatewayTxnId })}
                          </p>
                        )}
                      </div>
                    </div>

                    {r.selectedExtras && r.selectedExtras.length > 0 && (
                      <div className="px-6 pb-4 border-t border-gray-100 dark:border-slate-800/60 pt-4">
                        <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                          {t('vendor.refundRequests.addonsTitle')}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {r.selectedExtras.map((svc, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded-lg text-xs font-medium"
                            >
                              <Tag className="h-3 w-3" />
                              {svc.name} +{svc.price} {currency}
                              {svc.perPerson ? t('vendor.refundRequests.addonPerPerson') : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="px-6 py-4 border-t border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/20 flex flex-wrap items-center justify-between gap-4">
                      <div className="flex items-start gap-2 text-sm flex-1 min-w-0">
                        <Info className="h-4 w-4 text-gray-400 dark:text-slate-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-gray-700 dark:text-slate-300">
                            <span className="text-gray-500 dark:text-slate-400">{t('vendor.refundRequests.policyLabel')}</span>{' '}
                            <span className="font-medium">{cancellationPolicyLabel(r.activity.cancellationPolicy, t)}</span>
                            {' → '}
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">{suggested.label}</span>
                            {' ('}
                            {suggested.amount.toLocaleString()} {currency}
                            {')'}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{suggested.reason}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => openReject(r)}
                          disabled={decisionMutation.isPending}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 transition-colors"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          {t('vendor.refundRequests.actions.noRefund')}
                        </button>
                        <button
                          type="button"
                          onClick={() => openApprove(r)}
                          disabled={decisionMutation.isPending}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 shadow-sm transition-colors"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {t('vendor.refundRequests.actions.recordRefund')}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {decisionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div
                  className={`p-2 rounded-full ${
                    decisionModal.action === 'APPROVE'
                      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                      : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                  }`}
                >
                  {decisionModal.action === 'APPROVE' ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {decisionModal.action === 'APPROVE'
                    ? t('vendor.refundRequests.modal.titleApprove')
                    : t('vendor.refundRequests.modal.titleReject')}
                </h3>
              </div>

              <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
                {t('vendor.refundRequests.modal.bookingIntro', {
                  ref: decisionModal.booking.ref,
                  name: decisionModal.booking.customer.fullName,
                })}
              </p>

              {decisionModal.action === 'APPROVE' && (
                <div className="mb-4">
                  <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
                    {t('vendor.refundRequests.modal.amountLabel', {
                      currency: decisionModal.booking.currencyCode || 'QAR',
                    })}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={
                      decisionModal.booking.payment
                        ? Number(decisionModal.booking.payment.amount)
                        : Number(decisionModal.booking.totalPrice)
                    }
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                  <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1">
                    {t('vendor.refundRequests.modal.maxHint', {
                      amount:
                        decisionModal.booking.payment
                          ? Number(decisionModal.booking.payment.amount)
                          : Number(decisionModal.booking.totalPrice),
                    })}
                  </p>
                </div>
              )}

              <div className="mb-5">
                <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
                  {t('vendor.refundRequests.modal.noteLabel')}{' '}
                  <span className="text-gray-400 font-normal">{t('vendor.refundRequests.modal.noteOptional')}</span>
                </label>
                <textarea
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value.slice(0, 1000))}
                  rows={3}
                  placeholder={
                    decisionModal.action === 'APPROVE'
                      ? t('vendor.refundRequests.modal.placeholderApprove')
                      : t('vendor.refundRequests.modal.placeholderReject')
                  }
                  className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 resize-none"
                />
                <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">
                  {t('vendor.refundRequests.modal.charCount', { n: noteInput.length })}
                </p>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDecisionModal(null);
                    setAmountInput('');
                    setNoteInput('');
                  }}
                  disabled={decisionMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                >
                  {t('vendor.refundRequests.modal.cancel')}
                </button>
                <button
                  type="button"
                  onClick={confirmDecision}
                  disabled={decisionMutation.isPending}
                  className={`px-4 py-2 text-sm font-medium text-white rounded-xl transition-colors disabled:opacity-50 ${
                    decisionModal.action === 'APPROVE' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {decisionMutation.isPending
                    ? t('vendor.refundRequests.modal.saving')
                    : decisionModal.action === 'APPROVE'
                      ? t('vendor.refundRequests.modal.confirmRefund')
                      : t('vendor.refundRequests.modal.confirmReject')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
