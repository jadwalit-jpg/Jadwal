'use client';

import React, { useState } from 'react';
import { useAuth } from '@/context/auth-context';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/lib/api';
import { useToast } from '@/components/toast';
import { VendorSidebar } from '../../_components/vendor-sidebar';
import { bookingStatusLabel } from '@/lib/status-labels';
import { localized } from '@/lib/localize';
import {
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CalendarCheck,
  Clock,
  CheckCircle2,
  XCircle,
  Flag,
  Eye,
  X,
  Search,
  Sparkles,
  Tag,
} from 'lucide-react';
import CustomSelect from '@/components/custom-select';
import DatePicker from '@/components/date-picker';

// Visual config only — labels come from t('status.booking.*') via
// bookingStatusLabel() so they flip with the language toggle.
const STATUS_CONFIG: Record<string, { classes: string; icon: React.ElementType }> = {
  PENDING:   { classes: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',        icon: Clock },
  CONFIRMED: { classes: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',            icon: CheckCircle2 },
  COMPLETED: { classes: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: Flag },
  CANCELLED: { classes: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',                icon: XCircle },
};

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING:   ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * Gross (nominal) activity value before any discounts. Under the current
 * accounting model, totalPrice carries the vendor's full earned amount
 * regardless of payment method — Wanasa-paid bookings no longer store a
 * zero totalPrice. So reconstructing gross only requires adding back the
 * coupon (which reduces the vendor's stored price). pointsDiscount is a
 * customer-side saving and must NOT be added or the number double-counts.
 */
function computeNominalTotal(b: any): number {
  const t = Number(b.totalPrice || 0);
  const c = Number(b.couponDiscount || 0);
  return t + c;
}

const inputCls = 'px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 text-gray-900 dark:text-white placeholder:text-gray-400';

export default function VendorBookingsPage() {
  const { user } = useAuth();
  const { slug: _slug } = useParams() as { slug: string };
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState('');
  const [activityId, setActivityId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [confirmAction, setConfirmAction] = useState<{ id: string; status: string } | null>(null);
  const [viewBooking, setViewBooking] = useState<any>(null);

  const hasFilters = !!filterStatus || !!activityId || !!dateFrom || !!dateTo || !!searchDebounced;

  // Debounce search (300ms)
  const searchTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => { setSearchDebounced(value); setPage(1); }, 300);
  };

  const clearFilters = () => {
    setFilterStatus('');
    setActivityId('');
    setDateFrom('');
    setDateTo('');
    setSearch('');
    setSearchDebounced('');
    setPage(1);
  };

  const { data, isLoading } = useQuery({
    queryKey: [user?.id, 'vendor-bookings', page, filterStatus, activityId, dateFrom, dateTo, searchDebounced],
    queryFn: () =>
      api.get('/vendor/bookings', {
        params: {
          page,
          limit: 20,
          status: filterStatus || undefined,
          activityId: activityId || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          search: searchDebounced || undefined,
        },
      }).then(r => r.data),
    enabled: !!user,
  });

  const { data: activitiesData } = useQuery({
    queryKey: [user?.id, 'vendor-activities-for-filter'],
    queryFn: () =>
      api.get('/vendor/activities', { params: { limit: 100 } }).then(r => r.data),
    enabled: !!user,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/vendor/bookings/${id}/status`, { status }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: [user?.id, 'vendor-bookings'] });
      queryClient.invalidateQueries({ queryKey: [user?.id, 'vendor-dashboard-stats'] });
      toast(t('vendor.bookings.toast.statusChanged', { status: bookingStatusLabel(t, vars.status) }), 'success');
      setConfirmAction(null);
    },
    onError: () => {
      toast(t('vendor.bookings.toast.updateFailed'), 'error');
      setConfirmAction(null);
    },
  });

  const bookings = data?.data ?? [];
  const totalPages = data?.totalPages ?? 1;
  const filterActivities = activitiesData?.data ?? [];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 font-outfit text-gray-900 dark:text-white">
      <VendorSidebar />

      <main className="ms-64 p-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">{t('vendor.bookings.title')}</h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1">{t('vendor.bookings.subtitle')}</p>
        </div>

        {/* Search + Filters */}
        <div className="flex flex-wrap gap-3 mb-6 items-center">
          {/* Search */}
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder={t('vendor.bookings.searchPlaceholder')}
              className="px-3 py-2.5 ps-9 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 text-gray-900 dark:text-white placeholder:text-gray-400 w-56"
            />
            <Search className="absolute inset-s-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          </div>

          {/* Status */}
          <CustomSelect
            options={Object.keys(STATUS_CONFIG).map((val) => ({ value: val, label: bookingStatusLabel(t, val) }))}
            value={filterStatus}
            onChange={val => { setFilterStatus(val); setPage(1); }}
            placeholder={t('vendor.bookings.allStatuses')}
          />

          {/* Activity */}
          <CustomSelect
            options={filterActivities.map((a: any) => ({ value: a.id, label: localized(a, 'title') }))}
            value={activityId}
            onChange={val => { setActivityId(val); setPage(1); }}
            placeholder={t('vendor.bookings.allActivities')}
          />

          {/* Date From */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 dark:text-slate-400 font-medium whitespace-nowrap">{t('vendor.bookings.from')}</label>
            <DatePicker
              value={dateFrom}
              onChange={val => { setDateFrom(val); setPage(1); }}
              placeholder={t('vendor.bookings.startDate')}
            />
          </div>

          {/* Date To */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 dark:text-slate-400 font-medium whitespace-nowrap">{t('vendor.bookings.to')}</label>
            <DatePicker
              value={dateTo}
              onChange={val => { setDateTo(val); setPage(1); }}
              placeholder={t('vendor.bookings.endDate')}
            />
          </div>

          {/* Clear */}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              {t('vendor.bookings.clearFilters')}
            </button>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 rounded-2xl overflow-hidden">
          {isLoading ? (
            <div className="p-8 space-y-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-16 bg-gray-100 dark:bg-slate-800 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : bookings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <CalendarCheck className="h-10 w-10 text-gray-300 dark:text-slate-600 mb-3" />
              <p className="text-gray-500 dark:text-slate-400 font-medium">{t('vendor.bookings.noBookings')}</p>
              {hasFilters && (
                <button onClick={clearFilters} className="mt-2 text-sm text-teal-600 dark:text-teal-400 hover:underline">{t('vendor.bookings.clearFilters')}</button>
              )}
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 dark:border-slate-800">
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{t('vendor.bookings.thRef')}</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{t('vendor.bookings.thActivity')}</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{t('vendor.bookings.thCustomer')}</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{t('vendor.bookings.thDate')}</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{t('vendor.bookings.thGuests')}</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{t('vendor.bookings.thTotal')}</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{t('vendor.bookings.thPayment')}</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{t('vendor.bookings.thStatus')}</th>
                  <th className="text-end px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{t('vendor.bookings.thActions')}</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b: any) => {
                  const cfg = STATUS_CONFIG[b.status] ?? STATUS_CONFIG.PENDING;
                  const StatusIcon = cfg.icon;
                  const transitions = ALLOWED_TRANSITIONS[b.status] ?? [];
                  return (
                    <tr key={b.id} className="border-b border-gray-50 dark:border-slate-800/50 hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <span className="text-xs font-mono font-medium text-teal-600 dark:text-teal-400">{b.ref}</span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 dark:text-white max-w-[160px] truncate">{localized(b.activity, 'title')}</td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-gray-900 dark:text-white">{b.customer?.fullName}</p>
                        <p className="text-xs text-gray-400 dark:text-slate-500">{b.customer?.email}</p>
                        {b.customer?.phone && <p className="text-xs text-gray-400 dark:text-slate-500">{b.customer.phone}</p>}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-slate-300">
                        <p>{new Date(b.startDatetime).toLocaleDateString()}</p>
                        {(() => {
                          // Show the actual booked time range for HOURLY so
                          // the vendor sees when the customer is coming in
                          // and how long they booked — critical for scheduling
                          // after the flex-range rollout.
                          if (b.activity?.bookingType !== 'HOURLY') return null;
                          const start = new Date(b.startDatetime);
                          const end = new Date(b.endDatetime);
                          const hours = Math.round((end.getTime() - start.getTime()) / (60 * 60 * 1000));
                          const opts = { hour: '2-digit' as const, minute: '2-digit' as const, hour12: false, timeZone: 'UTC' };
                          return (
                            <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5 tabular-nums">
                              {start.toLocaleTimeString(undefined, opts)} — {end.toLocaleTimeString(undefined, opts)} · {hours}h
                            </p>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-slate-300">{b.guests}</td>
                      <td className="px-6 py-4">
                        {(() => {
                          const currency = b.currencyCode || b.activity?.country?.currencyCode || 'QAR';
                          const nominal = computeNominalTotal(b);
                          const pointsUsed = Number(b.pointsRedeemed || 0);
                          return (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-sm font-medium text-gray-900 dark:text-white">
                                {currency} {nominal.toFixed(0)}
                              </span>
                              {pointsUsed > 0 && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-600 dark:text-purple-400">
                                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                                  {t('vendor.bookings.ptsUsed', { count: pointsUsed })}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4">
                        {b.payment ? (
                          <div className="flex flex-col gap-1">
                            {b.payment.method === 'WANASA_POINTS' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 w-fit">
                                <Sparkles className="h-3 w-3" aria-hidden="true" />
                                Wanasa
                              </span>
                            )}
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium w-fit ${
                              b.payment.status === 'SUCCESS' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                              b.payment.status === 'REFUNDED' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                              b.payment.status === 'FAILED' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                              'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400'
                            }`}>
                              {b.payment.status === 'SUCCESS' ? t('vendor.bookings.payment.paid') :
                               b.payment.status === 'REFUNDED' ? t('vendor.bookings.payment.refund') :
                               b.payment.status === 'FAILED' ? t('vendor.bookings.payment.failed') : t('vendor.bookings.payment.pending')}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400 dark:text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${cfg.classes}`}>
                          <StatusIcon className="h-3 w-3" />
                          {bookingStatusLabel(t, b.status)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setViewBooking(b)}
                            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-slate-400 transition-colors"
                            title={t('vendor.bookings.actions.viewDetails')}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {transitions.length > 0 && transitions.map(s => {
                            // Complete is only meaningful once the event has
                            // ended. Hiding the button pre-end matches the
                            // backend guard and the 1 AM auto-complete cron —
                            // all three agree that "completed" = event occurred.
                            // Cancel remains available for future bookings
                            // (no-shows, vendor emergencies).
                            if (s === 'COMPLETED' && new Date(b.endDatetime).getTime() > Date.now()) {
                              return null;
                            }
                            return (
                              <button
                                key={s}
                                onClick={() => setConfirmAction({ id: b.id, status: s })}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                                  s === 'CANCELLED'
                                    ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40'
                                    : 'bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400 hover:bg-teal-100 dark:hover:bg-teal-900/40'
                                }`}
                              >
                                {s === 'CONFIRMED' ? t('vendor.bookings.actions.confirm') : s === 'COMPLETED' ? t('vendor.bookings.actions.complete') : t('vendor.bookings.actions.cancel')}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-slate-800">
              <p className="text-sm text-gray-500 dark:text-slate-400">{t('vendor.bookings.pagination.pageOf', { page, total: totalPages })}</p>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                  className="p-2 rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                  className="p-2 rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Confirm Status Modal. Cancel gets destructive styling + stronger copy
          because it triggers refund, customer notification, and freed capacity —
          all effects that can't be undone by a second click. */}
      {confirmAction && (() => {
        const isCancel = confirmAction.status === 'CANCELLED';
        const isComplete = confirmAction.status === 'COMPLETED';
        const title = isCancel
          ? t('vendor.bookings.confirm.cancelTitle')
          : isComplete
          ? t('vendor.bookings.confirm.completeTitle')
          : t('vendor.bookings.confirm.statusTitle', { status: bookingStatusLabel(t, confirmAction.status) });
        const body = isCancel
          ? t('vendor.bookings.confirm.cancelBody')
          : isComplete
          ? t('vendor.bookings.confirm.completeBody')
          : t('vendor.bookings.confirm.defaultBody');
        const primaryLabel = isCancel ? t('vendor.bookings.confirm.primaryCancel') : t('vendor.bookings.confirm.primaryConfirm');
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setConfirmAction(null)}>
            <div
              className="bg-white dark:bg-slate-900 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-4 mb-4">
                <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${
                  isCancel
                    ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                    : 'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400'
                }`}>
                  <AlertCircle className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h3>
                  <p className="mt-1 text-sm text-gray-500 dark:text-slate-400 leading-relaxed">{body}</p>
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setConfirmAction(null)}
                  disabled={statusMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-50"
                >
                  {t('vendor.bookings.confirm.keep')}
                </button>
                <button
                  onClick={() => statusMutation.mutate(confirmAction)}
                  disabled={statusMutation.isPending}
                  className={`px-4 py-2 text-sm font-medium text-white rounded-xl transition-colors disabled:opacity-50 ${
                    isCancel
                      ? 'bg-red-600 hover:bg-red-500'
                      : 'bg-teal-600 hover:bg-teal-500'
                  }`}
                >
                  {statusMutation.isPending ? t('vendor.bookings.confirm.updating') : primaryLabel}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* View Booking Details Modal */}
      {viewBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-slate-800">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">{t('vendor.bookings.details.title')}</h3>
              <button
                onClick={() => setViewBooking(null)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-slate-400 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {/* Booking Ref */}
              <div className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-slate-800/50">
                <span className="text-sm text-gray-500 dark:text-slate-400">{t('vendor.bookings.details.ref')}</span>
                <span className="font-mono text-sm font-bold text-teal-600 dark:text-teal-400">{viewBooking.ref}</span>
              </div>
              {/* Customer */}
              <div className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-slate-800/50">
                <span className="text-sm text-gray-500 dark:text-slate-400">{t('vendor.bookings.details.customer')}</span>
                <div className="text-end">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{viewBooking.customer?.fullName}</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500">{viewBooking.customer?.email}</p>
                  {viewBooking.customer?.phone && (
                    <p className="text-xs text-gray-400 dark:text-slate-500">{viewBooking.customer.phone}</p>
                  )}
                </div>
              </div>
              {/* Activity */}
              <div className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-slate-800/50">
                <span className="text-sm text-gray-500 dark:text-slate-400">{t('vendor.bookings.details.activity')}</span>
                <span className="text-sm font-medium text-gray-900 dark:text-white text-end max-w-[200px]">{localized(viewBooking.activity, 'title')}</span>
              </div>
              {/* Start Date/Time */}
              <div className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-slate-800/50">
                <span className="text-sm text-gray-500 dark:text-slate-400">{t('vendor.bookings.details.startDatetime')}</span>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {new Date(viewBooking.startDatetime).toLocaleString()}
                </span>
              </div>
              {/* Guests */}
              <div className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-slate-800/50">
                <span className="text-sm text-gray-500 dark:text-slate-400">{t('vendor.bookings.details.guests')}</span>
                <span className="text-sm font-medium text-gray-900 dark:text-white">{viewBooking.guests}</span>
              </div>
              {/* Pricing breakdown — shows nominal event value, any points/
                  coupon discounts, and what the customer actually paid in cash.
                  Essential for vendors to see bookings paid entirely via
                  Wanasa points (totalPrice = 0) with the real activity value. */}
              {(() => {
                const currency = viewBooking.currencyCode || viewBooking.activity?.country?.currencyCode || 'QAR';
                const nominal = computeNominalTotal(viewBooking);
                const pointsUsed = Number(viewBooking.pointsRedeemed || 0);
                const pointsValue = Number(viewBooking.pointsDiscount || 0);
                const couponValue = Number(viewBooking.couponDiscount || 0);
                const cashPaid = Number(viewBooking.payment?.amount || 0);
                return (
                  <>
                    <div className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-slate-800/50">
                      <span className="text-sm text-gray-500 dark:text-slate-400">{t('vendor.bookings.details.activityValue')}</span>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">{currency} {nominal.toFixed(2)}</span>
                    </div>
                    {couponValue > 0 && (
                      <div className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-slate-800/50">
                        <span className="text-sm text-gray-500 dark:text-slate-400 inline-flex items-center gap-1.5">
                          <Tag className="h-3.5 w-3.5" aria-hidden="true" />
                          {t('vendor.bookings.details.coupon')}{viewBooking.couponCode ? ` (${viewBooking.couponCode})` : ''}
                        </span>
                        <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">− {currency} {couponValue.toFixed(2)}</span>
                      </div>
                    )}
                    {pointsUsed > 0 && (
                      <div className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-slate-800/50">
                        <span className="text-sm text-gray-500 dark:text-slate-400 inline-flex items-center gap-1.5">
                          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                          {t('vendor.bookings.details.pointsUsed')}
                        </span>
                        <span className="text-sm font-medium text-purple-600 dark:text-purple-400">
                          {t('vendor.dashboard.pts', { count: pointsUsed })} <span className="text-gray-400 dark:text-slate-500 font-normal">(−{currency} {pointsValue.toFixed(2)})</span>
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-slate-800/50">
                      <span className="text-sm text-gray-500 dark:text-slate-400">{t('vendor.bookings.details.cashPaid')}</span>
                      <span className="text-sm font-bold text-gray-900 dark:text-white">{currency} {cashPaid.toFixed(2)}</span>
                    </div>
                  </>
                );
              })()}
              {/* Payment method + status */}
              <div className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-slate-800/50">
                <span className="text-sm text-gray-500 dark:text-slate-400">{t('vendor.bookings.details.payment')}</span>
                {viewBooking.payment ? (
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1.5">
                      {viewBooking.payment.method === 'WANASA_POINTS' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                          <Sparkles className="h-3 w-3" aria-hidden="true" />
                          Wanasa
                        </span>
                      )}
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium ${
                        viewBooking.payment.status === 'SUCCESS' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                        viewBooking.payment.status === 'REFUNDED' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                        viewBooking.payment.status === 'FAILED' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                        'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}>
                        {viewBooking.payment.status === 'SUCCESS' ? t('vendor.bookings.payment.paid') :
                         viewBooking.payment.status === 'REFUNDED' ? t('vendor.bookings.payment.refundPending') :
                         viewBooking.payment.status === 'FAILED' ? t('vendor.bookings.payment.failed') : t('vendor.bookings.payment.pending')}
                      </span>
                    </div>
                    {viewBooking.payment.paidAt && (
                      <p className="text-xs text-gray-400 dark:text-slate-500">
                        {new Date(viewBooking.payment.paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-gray-400 dark:text-slate-500">{t('vendor.bookings.payment.noPayment')}</span>
                )}
              </div>
              {/* Status */}
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-gray-500 dark:text-slate-400">{t('vendor.bookings.details.status')}</span>
                {(() => {
                  const cfg = STATUS_CONFIG[viewBooking.status] ?? STATUS_CONFIG.PENDING;
                  const StatusIcon = cfg.icon;
                  return (
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${cfg.classes}`}>
                      <StatusIcon className="h-3 w-3" />
                      {bookingStatusLabel(t, viewBooking.status)}
                    </span>
                  );
                })()}
              </div>
            </div>
            <div className="px-6 pb-5 flex justify-end">
              <button
                onClick={() => setViewBooking(null)}
                className="px-5 py-2 text-sm font-medium bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-300 rounded-xl transition-colors"
              >
                {t('vendor.bookings.details.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
