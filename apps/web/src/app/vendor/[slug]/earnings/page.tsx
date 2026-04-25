'use client';

import React, { useMemo, useState } from 'react';
import { useAuth } from '@/context/auth-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/lib/api';
import { getApiError } from '@/lib/utils';
import { useToast } from '@/components/toast';
import { VendorSidebar } from '../../_components/vendor-sidebar';
import { payoutRequestStatusLabel, payoutStatusLabel } from '@/lib/status-labels';
import { localized } from '@/lib/localize';
import { Wallet, TrendingUp, Clock, ArrowDownCircle, Send, Sparkles, ChevronLeft, ChevronRight, CheckCheck, CheckCircle2, XCircle, AlertCircle, Trash2, X } from 'lucide-react';

const PAYOUT_REQ_STATUS_VIS: Record<
  string,
  { cls: string; Icon: typeof Clock }
> = {
  PENDING: {
    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    Icon: Clock,
  },
  APPROVED: {
    cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    Icon: CheckCircle2,
  },
  COMPLETED: {
    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    Icon: CheckCheck,
  },
  REJECTED: {
    cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    Icon: XCircle,
  },
};

function payoutRequestStatusChipClasses(status: string): { cls: string; Icon: typeof Clock } {
  return PAYOUT_REQ_STATUS_VIS[status] ?? {
    cls: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    Icon: Clock,
  };
}

export default function VendorEarningsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: [user?.id, 'vendor-earnings'],
    queryFn: () => api.get('/vendor/earnings').then(r => r.data),
    enabled: !!user,
  });

  const { data: eligibility } = useQuery<{
    ok: boolean;
    code?: string;
    message?: string;
    available: number;
    currency: string;
    minimum: number;
  }>({
    queryKey: [user?.id, 'vendor-payout-eligibility'],
    queryFn: () => api.get('/vendor/payout-requests/eligibility').then(r => r.data),
    enabled: !!user,
    staleTime: 30_000,
  });

  const [payoutsPage, setPayoutsPage] = useState(1);
  const { data: payoutRequests } = useQuery({
    queryKey: [user?.id, 'vendor-payout-requests', payoutsPage],
    queryFn: () => api.get('/vendor/payout-requests', { params: { page: payoutsPage, limit: 10 } }).then(r => r.data),
    enabled: !!user,
  });

  const [clearTarget, setClearTarget] = useState<{ id: string; amount: string; currency: string } | null>(null);

  const clearRejectedMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/vendor/payout-requests/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [user?.id, 'vendor-payout-requests'] });
      setClearTarget(null);
      toast(t('vendor.earnings.toast.clearedRejected'), 'success');
    },
    onError: (err) => {
      toast(getApiError(err, t('vendor.earnings.toast.clearFailed')), 'error');
    },
  });

  const requestPayoutMutation = useMutation({
    mutationFn: () => api.post('/vendor/payout-requests'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [user?.id, 'vendor-payout-requests'] });
      queryClient.invalidateQueries({ queryKey: [user?.id, 'vendor-earnings'] });
      queryClient.invalidateQueries({ queryKey: [user?.id, 'vendor-payout-eligibility'] });
      toast(t('vendor.earnings.toast.requestSubmitted'), 'success');
    },
    onError: (err) => {
      toast(getApiError(err, t('vendor.earnings.toast.requestFailed')), 'error');
    },
  });

  const currency = data?.currency ?? 'QAR';

  const stats = useMemo(
    () =>
      [
        {
          label: t('vendor.earnings.stats.transferred.label'),
          value: data ? `${currency} ${Number(data.totalEarned).toFixed(2)}` : t('vendor.earnings.dash'),
          icon: Wallet,
          color: 'text-emerald-600 dark:text-emerald-400',
          bg: 'bg-emerald-50 dark:bg-emerald-900/30',
          sub: t('vendor.earnings.stats.transferred.sub'),
        },
        {
          label: t('vendor.earnings.stats.available.label'),
          value: data ? `${currency} ${Number(data.pendingPayout).toFixed(2)}` : t('vendor.earnings.dash'),
          icon: TrendingUp,
          color: 'text-teal-600 dark:text-teal-400',
          bg: 'bg-teal-50 dark:bg-teal-900/30',
          sub: t('vendor.earnings.stats.available.sub'),
        },
        {
          label: t('vendor.earnings.stats.inProgress.label'),
          value: t('vendor.earnings.dash'),
          icon: Clock,
          color: 'text-amber-600 dark:text-amber-400',
          bg: 'bg-amber-50 dark:bg-amber-900/30',
          sub: t('vendor.earnings.stats.inProgress.sub'),
          key: 'inflight',
        },
      ] as Array<{
        label: string;
        value: string;
        icon: typeof Wallet;
        color: string;
        bg: string;
        sub?: string;
        key?: string;
      }>,
    [t, data, currency],
  );

  const inflightAmount = useMemo(() => {
    const rows: Array<{ amount: string; status: string }> = payoutRequests?.data ?? [];
    return rows.filter((r) => r.status === 'PENDING' || r.status === 'APPROVED').reduce((sum, r) => sum + Number(r.amount), 0);
  }, [payoutRequests]);

  const statsWithInflight = useMemo(() => {
    return stats.map((s) =>
      s.key === 'inflight' ? { ...s, value: `${currency} ${inflightAmount.toFixed(2)}` } : s,
    );
  }, [stats, currency, inflightAmount]);

  const payments = data?.recentPayments ?? [];

  const blockerMessage = (blocker: { code?: string; message?: string }) => {
    const code = blocker.code;
    if (code) {
      return t(`vendor.earnings.eligibility.${code}`, {
        defaultValue: blocker.message || t('vendor.earnings.eligibility.generic'),
      });
    }
    return blocker.message || t('vendor.earnings.eligibility.generic');
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 font-outfit text-gray-900 dark:text-white">
      <VendorSidebar />

      <main className="ms-64 p-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">{t('vendor.earnings.title')}</h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1">{t('vendor.earnings.subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          {statsWithInflight.map(({ label, value, icon: Icon, color, bg, sub }, idx) => (
            <div key={idx} className="p-6 bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 rounded-2xl">
              {isLoading ? (
                <div className="space-y-3">
                  <div className="h-4 w-28 bg-gray-100 dark:bg-slate-800 rounded animate-pulse" />
                  <div className="h-8 w-24 bg-gray-100 dark:bg-slate-800 rounded animate-pulse" />
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-gray-500 dark:text-slate-400">{label}</p>
                    <div className={`h-9 w-9 rounded-xl ${bg} flex items-center justify-center`}>
                      <Icon className={`h-4 w-4 ${color}`} />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
                  {sub ? <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1.5">{sub}</p> : null}
                </>
              )}
            </div>
          ))}
        </div>

        {(() => {
          const canRequest = eligibility?.ok === true;
          const blocker = eligibility && !eligibility.ok ? { code: eligibility.code, message: eligibility.message } : null;
          const stillLoading = !eligibility;
          const amountLabel = eligibility ? `${eligibility.available.toFixed(2)} ${eligibility.currency}` : null;
          const themed = blocker
            ? {
                wrap: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50',
                iconWrap: 'text-amber-600 dark:text-amber-400',
                title: 'text-amber-700 dark:text-amber-300',
                sub: 'text-amber-600/80 dark:text-amber-400/70',
              }
            : {
                wrap: 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800/50',
                iconWrap: 'text-teal-600 dark:text-teal-400',
                title: 'text-teal-700 dark:text-teal-400',
                sub: 'text-teal-600/70 dark:text-teal-400/60',
              };
          const Icon = blocker ? AlertCircle : ArrowDownCircle;
          return (
            <div className={`mb-6 p-5 border rounded-2xl ${themed.wrap}`}>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-start gap-3 min-w-0">
                  <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${themed.iconWrap}`} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${themed.title}`}>{t('vendor.earnings.requestPayout.title')}</p>
                    <p className={`text-xs mt-0.5 leading-relaxed ${themed.sub}`}>
                      {stillLoading
                        ? t('vendor.earnings.requestPayout.checking')
                        : blocker
                          ? blockerMessage(blocker)
                          : t('vendor.earnings.requestPayout.readyToWithdraw', { amount: amountLabel ?? '' })}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => requestPayoutMutation.mutate()}
                  disabled={requestPayoutMutation.isPending || !canRequest || stillLoading}
                  className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
                  title={blocker ? blockerMessage(blocker) : undefined}
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  {requestPayoutMutation.isPending ? t('vendor.earnings.requestPayout.requesting') : t('vendor.earnings.requestPayout.button')}
                </button>
              </div>
            </div>
          );
        })()}

        {payoutRequests?.data?.length > 0 && (
          <div className="mb-6 bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 rounded-2xl overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">{t('vendor.earnings.payoutRequests.title')}</h2>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{t('vendor.earnings.payoutRequests.subtitle')}</p>
              </div>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 dark:border-slate-800">
                  <th className="text-start px-6 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.earnings.payoutRequests.thRequested')}
                  </th>
                  <th className="text-start px-6 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.earnings.payoutRequests.thAmount')}
                  </th>
                  <th className="text-start px-6 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.earnings.payoutRequests.thStatus')}
                  </th>
                  <th className="text-start px-6 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.earnings.payoutRequests.thProcessed')}
                  </th>
                  <th className="text-start px-6 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.earnings.payoutRequests.thAdminNote')}
                  </th>
                  <th className="text-end px-6 py-3 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {payoutRequests.data.map((req: any) => {
                  const statusVis = payoutRequestStatusChipClasses(req.status);
                  const StatusIcon = statusVis.Icon;
                  return (
                    <tr
                      key={req.id}
                      className="border-b border-gray-50 dark:border-slate-800/50 last:border-0 hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-slate-300">
                        {new Date(req.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-gray-900 dark:text-white tabular-nums">
                        {Number(req.amount).toFixed(2)} {req.currency}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${statusVis.cls}`}>
                          <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          {payoutRequestStatusLabel(t, req.status)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-500 dark:text-slate-400">
                        {req.processedAt
                          ? new Date(req.processedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                          : t('vendor.earnings.dash')}
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-600 dark:text-slate-400 max-w-[240px]">
                        {req.adminNote ? (
                          <span className="italic">“{req.adminNote.split('\n')[0]}”</span>
                        ) : (
                          <span className="text-gray-400 dark:text-slate-500">{t('vendor.earnings.dash')}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-end">
                        {req.status === 'REJECTED' ? (
                          <button
                            type="button"
                            onClick={() => setClearTarget({ id: req.id, amount: String(req.amount), currency: req.currency })}
                            className="inline-flex items-center gap-1 p-1.5 rounded-lg text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                            title={t('vendor.earnings.payoutRequests.clearRowTitle')}
                            aria-label={t('vendor.earnings.payoutRequests.clearRowAria')}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {payoutRequests.totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-slate-800">
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  {t('vendor.earnings.payoutRequests.pagination.pageOf', {
                    page: payoutRequests.page,
                    total: payoutRequests.totalPages,
                  })}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPayoutsPage((p) => Math.max(1, p - 1))}
                    disabled={payoutsPage <= 1}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-all"
                  >
                    <ChevronLeft className="h-4 w-4 text-gray-600 dark:text-slate-400" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayoutsPage((p) => Math.min(payoutRequests.totalPages, p + 1))}
                    disabled={payoutsPage >= payoutRequests.totalPages}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-all"
                  >
                    <ChevronRight className="h-4 w-4 text-gray-600 dark:text-slate-400" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 rounded-2xl overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 dark:border-slate-800">
            <h2 className="text-lg font-bold">{t('vendor.earnings.paymentHistory.title')}</h2>
          </div>

          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 bg-gray-100 dark:bg-slate-800 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : payments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Wallet className="h-10 w-10 text-gray-300 dark:text-slate-600 mb-3" />
              <p className="text-gray-500 dark:text-slate-400 font-medium">{t('vendor.earnings.paymentHistory.emptyTitle')}</p>
              <p className="text-gray-400 dark:text-slate-500 text-sm mt-1">{t('vendor.earnings.paymentHistory.emptySubtitle')}</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 dark:border-slate-800">
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.earnings.paymentHistory.thBookingRef')}
                  </th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.earnings.paymentHistory.thActivity')}
                  </th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.earnings.paymentHistory.thDate')}
                  </th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.earnings.paymentHistory.thAmount')}
                  </th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.earnings.paymentHistory.thPayout')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p: any) => {
                  const cashToVendor = Number(p.totalPrice || 0) - Number(p.commissionAmount ?? 0);
                  const pts = Number(p.pointsRedeemed || 0);
                  const isWanasa = p.payment?.method === 'WANASA_POINTS';
                  const payoutSt = p.payment?.payoutStatus === 'PAID' ? 'PAID' : 'UNPAID';
                  return (
                    <tr key={p.payment?.id ?? p.ref} className="border-b border-gray-50 dark:border-slate-800/50 hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <span className="text-xs font-mono font-medium text-teal-600 dark:text-teal-400">{p.ref}</span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 dark:text-white max-w-[200px] truncate">{localized(p.activity, 'title')}</td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-slate-400">
                        {p.payment?.createdAt ? new Date(p.payment.createdAt).toLocaleDateString() : t('vendor.earnings.dash')}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">
                            {p.currencyCode || currency} {cashToVendor.toFixed(2)}
                          </span>
                          {isWanasa ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-600 dark:text-purple-400 w-fit">
                              <Sparkles className="h-3 w-3" aria-hidden="true" />
                              {t('vendor.earnings.paymentHistory.paidByWanasa')}
                            </span>
                          ) : pts > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-600 dark:text-purple-400 w-fit">
                              <Sparkles className="h-3 w-3" aria-hidden="true" />
                              {t('vendor.earnings.paymentHistory.ptsApplied', { pts })}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                            payoutSt === 'PAID'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                          }`}
                        >
                          {payoutStatusLabel(t, payoutSt)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {clearTarget && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => !clearRejectedMutation.isPending && setClearTarget(null)}
          >
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between p-6 pb-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-11 w-11 rounded-xl bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                    <Trash2 className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">{t('vendor.earnings.clearModal.title')}</h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-slate-400 leading-relaxed">
                      {t('vendor.earnings.clearModal.body', {
                        amount: `${Number(clearTarget.amount).toFixed(2)} ${clearTarget.currency}`,
                      })}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => !clearRejectedMutation.isPending && setClearTarget(null)}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="px-6 pb-6 pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setClearTarget(null)}
                  disabled={clearRejectedMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-50"
                >
                  {t('vendor.earnings.clearModal.keep')}
                </button>
                <button
                  type="button"
                  onClick={() => clearRejectedMutation.mutate(clearTarget.id)}
                  disabled={clearRejectedMutation.isPending}
                  className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {clearRejectedMutation.isPending ? t('vendor.earnings.clearModal.clearing') : t('vendor.earnings.clearModal.clear')}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
