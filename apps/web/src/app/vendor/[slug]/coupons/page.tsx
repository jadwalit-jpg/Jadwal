'use client';

import { pickBadge } from '@/lib/status-config';

import React, { useState, useMemo } from 'react';
import { useAuth } from '@/context/auth-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import api from '@/lib/api';
import { localized } from '@/lib/localize';
import { getApiError } from '@/lib/api-error';
import { sanitize } from '@/lib/validation';
import { useToast } from '@/components/toast';
import { VendorSidebar } from '../../_components/vendor-sidebar';
import { payoutRequestStatusLabel } from '@/lib/status-labels';
import {
  Plus,
  X,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Tag,
  RefreshCw,
} from 'lucide-react';

interface Coupon {
  id: string;
  code: string;
  discountType: 'PERCENTAGE' | 'FIXED';
  discountValue: number;
  validFrom: string;
  validTo: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  usageLimit: number | null;
  usageCount: number;
  /** Empty = applies to every activity; otherwise scoped to these activity ids. */
  applicableActivityIds?: string[];
}

// Kept Record<string> (not exhaustive): the vendor coupon UI models a REJECTED
// status that the Prisma CouponStatus enum doesn't have (FE/backend drift), so
// pickBadge runtime-guards it instead of an exhaustive compile check.
const STATUS_VIS: Record<string, { classes: string; icon: React.ElementType }> = {
  PENDING: {
    classes: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    icon: Clock,
  },
  APPROVED: {
    classes: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    icon: CheckCircle2,
  },
  REJECTED: {
    classes: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    icon: XCircle,
  },
  EXPIRED: {
    classes: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400',
    icon: AlertCircle,
  },
};

const FILTER_TABS = ['All', 'APPROVED', 'PENDING', 'REJECTED'] as const;

function couponStatusLabel(t: TFunction, status: string) {
  if (status === 'EXPIRED') return t('vendor.coupons.statusExpired');
  return payoutRequestStatusLabel(t, status);
}

const inputCls =
  'w-full px-4 py-2.5 bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500';

function generateCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

const EMPTY_FORM = {
  code: '',
  discountType: 'PERCENTAGE' as 'PERCENTAGE' | 'FIXED',
  discountValue: '',
  validFrom: '',
  validTo: '',
  usageLimit: '',
  activityIds: [] as string[],
};

export default function VendorCouponsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const statusParam = filterStatus === 'All' ? undefined : filterStatus;

  const { data, isLoading } = useQuery({
    queryKey: [user?.id, 'vendor-coupons', page, filterStatus],
    queryFn: () =>
      api.get('/vendor/coupons', {
        params: { page, limit: 20, status: statusParam },
      }).then((r) => r.data),
    enabled: !!user,
  });

  const { data: activitiesData } = useQuery({
    queryKey: [user?.id, 'vendor-activities-for-coupons'],
    queryFn: () => api.get('/vendor/activities', { params: { limit: 100 } }).then((r) => r.data),
    // Loaded whenever the page is open (not just the create modal) so the table
    // can resolve each coupon's applicable-activity ids to readable titles.
    enabled: !!user,
  });

  const createMutation = useMutation({
    mutationFn: (payload: any) => api.post('/vendor/coupons', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [user?.id, 'vendor-coupons'] });
      toast(t('vendor.coupons.toast.created'), 'success');
      setShowModal(false);
      setForm(EMPTY_FORM);
    },
    onError: (err) => toast(getApiError(err, t('vendor.coupons.toast.createFailed')), 'error'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code || !form.discountValue || !form.validFrom || !form.validTo) {
      toast(t('vendor.coupons.toast.fillRequired'), 'error');
      return;
    }
    if (Number(form.discountValue) <= 0) {
      toast(t('vendor.coupons.toast.discountPositive'), 'error');
      return;
    }
    if (form.discountType === 'PERCENTAGE' && Number(form.discountValue) > 100) {
      toast(t('vendor.coupons.toast.percentMax'), 'error');
      return;
    }
    if (new Date(form.validTo) <= new Date(form.validFrom)) {
      toast(t('vendor.coupons.toast.validToAfterFrom'), 'error');
      return;
    }
    createMutation.mutate({
      code: sanitize(form.code.toUpperCase()),
      discountType: form.discountType,
      discountValue: Number(form.discountValue),
      validFrom: form.validFrom,
      validTo: form.validTo,
      usageLimit: form.usageLimit ? Number(form.usageLimit) : undefined,
      activityIds: form.activityIds,
    });
  };

  const toggleActivity = (id: string) => {
    setForm((prev) => ({
      ...prev,
      activityIds: prev.activityIds.includes(id) ? prev.activityIds.filter((a) => a !== id) : [...prev.activityIds, id],
    }));
  };

  const coupons: Coupon[] = data?.data ?? [];
  const totalPages = data?.totalPages ?? 1;
  const activities = activitiesData?.data ?? [];

  // id → localized title, so the coupon table can show WHICH activities a
  // restricted coupon applies to (confirms the create-form selection stuck).
  const activityTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of activities as { id: string }[]) m.set(a.id, localized(a, 'title'));
    return m;
  }, [activities]);

  // Human label for a coupon's scope: "All activities", the resolved names, or
  // a count fallback when names aren't loaded (e.g. >100 activities).
  const couponScopeLabel = (ids?: string[]): { text: string; scoped: boolean } => {
    const list = ids ?? [];
    if (list.length === 0) return { text: t('vendor.coupons.allActivities', { defaultValue: 'All activities' }), scoped: false };
    const names = list.map((id) => activityTitleById.get(id)).filter(Boolean) as string[];
    if (names.length === list.length) return { text: names.join(', '), scoped: true };
    const text = list.length === 1
      ? t('vendor.coupons.appliesToCountOne', { count: list.length, defaultValue: '1 activity' })
      : t('vendor.coupons.appliesToCount', { count: list.length, defaultValue: `${list.length} activities` });
    return { text, scoped: true };
  };

  const filterTabLabel = (tab: (typeof FILTER_TABS)[number]) => {
    if (tab === 'All') return t('vendor.coupons.filterAll');
    return payoutRequestStatusLabel(t, tab);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 font-outfit text-gray-900 dark:text-white">
      <VendorSidebar />

      <main className="md:ms-64 p-4 md:p-10 overflow-x-hidden">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t('vendor.coupons.title')}</h1>
            <p className="text-gray-500 dark:text-slate-400 mt-1">{t('vendor.coupons.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-linear-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white rounded-xl font-semibold transition-all shadow-lg shadow-teal-600/20 dark:shadow-teal-900/40 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            {t('vendor.coupons.createButton')}
          </button>
        </div>

        <div className="flex gap-1 mb-6 p-1 bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 rounded-xl w-fit">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setFilterStatus(tab);
                setPage(1);
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                filterStatus === tab
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200'
              }`}
            >
              {filterTabLabel(tab)}
            </button>
          ))}
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 rounded-2xl overflow-hidden">
          {isLoading ? (
            <div className="p-8 space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 bg-gray-100 dark:bg-slate-800 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : coupons.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Tag className="h-10 w-10 text-gray-300 dark:text-slate-600 mb-3" />
              <p className="text-gray-500 dark:text-slate-400 font-medium">{t('vendor.coupons.emptyTitle')}</p>
              <p className="text-gray-400 dark:text-slate-500 text-sm mt-1">{t('vendor.coupons.emptySubtitle')}</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 dark:border-slate-800">
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.coupons.thCode')}
                  </th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.coupons.thDiscount')}
                  </th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.coupons.thAppliesTo', { defaultValue: 'Applies To' })}
                  </th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.coupons.thExpiry')}
                  </th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.coupons.thUsage')}
                  </th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.coupons.thStatus')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((c) => {
                  const cfg = pickBadge(STATUS_VIS, c.status, STATUS_VIS.PENDING);
                  const StatusIcon = cfg.icon;
                  const scope = couponScopeLabel(c.applicableActivityIds);
                  return (
                    <tr key={c.id} className="border-b border-gray-50 dark:border-slate-800/50 hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <span className="font-mono text-sm font-bold text-gray-900 dark:text-white">{c.code}</span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-slate-300">
                        {c.discountType === 'PERCENTAGE'
                          ? t('vendor.coupons.discountPercent', { value: c.discountValue })
                          : t('vendor.coupons.discountFixed', { value: c.discountValue, defaultValue: `QAR ${c.discountValue} off` })}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {scope.scoped ? (
                          <span className="inline-flex items-center gap-1.5 text-gray-700 dark:text-slate-300" title={scope.text}>
                            <Tag className="h-3.5 w-3.5 text-teal-500 shrink-0" aria-hidden="true" />
                            <span className="truncate max-w-[220px]">{scope.text}</span>
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-slate-500">{scope.text}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-slate-300">
                        {new Date(c.validFrom).toLocaleDateString()} – {new Date(c.validTo).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-slate-300">
                        {c.usageCount} / {c.usageLimit ?? t('vendor.coupons.usageUnlimited')}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${cfg.classes}`}>
                          <StatusIcon className="h-3 w-3" />
                          {couponStatusLabel(t, c.status)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-slate-800">
              <p className="text-sm text-gray-500 dark:text-slate-400">
                {t('vendor.coupons.paginationSummary', { page, total: totalPages, count: data?.total ?? 0 })}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                >
                  {t('vendor.coupons.prev')}
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                >
                  {t('vendor.coupons.next')}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-slate-800 shrink-0">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t('vendor.coupons.modalTitle')}</h2>
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  setForm(EMPTY_FORM);
                }}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-slate-400 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">{t('vendor.coupons.fieldCode')}</label>
                <div className="flex gap-2">
                  <input
                    value={form.code}
                    onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                    className={inputCls}
                    placeholder={t('vendor.coupons.codePlaceholder')}
                  />
                  <button
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, code: generateCode() }))}
                    title={t('vendor.coupons.generateTitle')}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-300 rounded-xl text-xs font-medium transition-colors"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t('vendor.coupons.generate')}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">{t('vendor.coupons.discountType')}</label>
                <div className="flex gap-3">
                  {(['PERCENTAGE', 'FIXED'] as const).map((type) => (
                    <label
                      key={type}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border cursor-pointer transition-colors text-sm font-medium ${
                        form.discountType === type
                          ? 'border-teal-400 dark:border-teal-600 bg-teal-50/50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400'
                          : 'border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-600'
                      }`}
                    >
                      <input
                        type="radio"
                        name="discountType"
                        value={type}
                        checked={form.discountType === type}
                        onChange={() => setForm((p) => ({ ...p, discountType: type }))}
                        className="accent-teal-600"
                      />
                      {type === 'PERCENTAGE' ? t('vendor.coupons.typePercentage') : t('vendor.coupons.typeFixed')}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">
                  {t('vendor.coupons.discountValue')}{' '}
                  {form.discountType === 'PERCENTAGE' ? t('vendor.coupons.suffixPercent') : t('vendor.coupons.suffixFixed')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={form.discountType === 'PERCENTAGE' ? 100 : undefined}
                  value={form.discountValue}
                  onChange={(e) => setForm((p) => ({ ...p, discountValue: e.target.value }))}
                  className={inputCls}
                  placeholder={form.discountType === 'PERCENTAGE' ? t('vendor.coupons.placeholderPercent') : t('vendor.coupons.placeholderFixed')}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">{t('vendor.coupons.validFrom')}</label>
                  <input
                    type="date"
                    value={form.validFrom}
                    onChange={(e) => setForm((p) => ({ ...p, validFrom: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">{t('vendor.coupons.validTo')}</label>
                  <input
                    type="date"
                    value={form.validTo}
                    onChange={(e) => setForm((p) => ({ ...p, validTo: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">
                  {t('vendor.coupons.usageLimit')}{' '}
                  <span className="text-gray-400 dark:text-slate-500 font-normal">{t('vendor.coupons.usageLimitHint')}</span>
                </label>
                <input
                  type="number"
                  min={1}
                  value={form.usageLimit}
                  onChange={(e) => setForm((p) => ({ ...p, usageLimit: e.target.value }))}
                  className={inputCls}
                  placeholder={t('vendor.coupons.usageLimitPlaceholder')}
                />
              </div>

              {activities.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">
                    {t('vendor.coupons.activitiesLabel')}{' '}
                    <span className="text-gray-400 dark:text-slate-500 font-normal">{t('vendor.coupons.activitiesHint')}</span>
                  </label>
                  <div className="space-y-2 max-h-40 overflow-y-auto p-3 bg-gray-50 dark:bg-slate-800/40 border border-gray-200 dark:border-slate-700 rounded-xl">
                    {activities.map((a: any) => (
                      <label key={a.id} className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.activityIds.includes(a.id)}
                          onChange={() => toggleActivity(a.id)}
                          className="accent-teal-600 h-4 w-4 rounded"
                        />
                        <span className="text-sm text-gray-700 dark:text-slate-300">{localized(a, 'title')}</span>
                      </label>
                    ))}
                  </div>
                  {form.activityIds.length > 0 && (
                    <p className="text-xs text-teal-600 dark:text-teal-400 mt-1">
                      {form.activityIds.length === 1
                        ? t('vendor.coupons.selectedCountOne')
                        : t('vendor.coupons.selectedCountOther', { count: form.activityIds.length })}
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setForm(EMPTY_FORM);
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                >
                  {t('vendor.coupons.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="flex items-center gap-2 px-5 py-2 bg-linear-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                >
                  {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('vendor.coupons.submitApproval')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
