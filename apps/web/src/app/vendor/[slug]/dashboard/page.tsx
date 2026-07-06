'use client';

import { pickBadge, type ActivityStatus, type BookingStatus } from '@/lib/status-config';

import React, { useMemo } from 'react';
import { useAuth } from '@/context/auth-context';
import { useRouter, useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/lib/api';
import { VendorSidebar } from '../../_components/vendor-sidebar';
import { bookingStatusLabel } from '@/lib/status-labels';
import { localized } from '@/lib/localize';
import {
  CalendarRange,
  CalendarCheck,
  Plus,
  Activity,
  ChevronRight,
  TrendingUp,
  Sparkles,
  Receipt,
} from 'lucide-react';

export default function VendorDashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { slug } = useParams() as { slug: string };
  const { t } = useTranslation();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: [user?.id, 'vendor-dashboard-stats'],
    queryFn: () => api.get('/vendor/dashboard/stats').then(r => r.data),
    enabled: !loading && !!user,
    staleTime: 60_000,
  });

  const { data: recentActivities, isLoading: activitiesLoading } = useQuery({
    queryKey: [user?.id, 'vendor-recent-activities'],
    queryFn: () => api.get('/vendor/activities', { params: { limit: 5 } }).then(r => r.data),
    enabled: !loading && !!user,
    staleTime: 60_000,
  });

  const { data: revenueChart, isLoading: chartLoading } = useQuery({
    queryKey: [user?.id, 'vendor-revenue-chart'],
    queryFn: () => api.get('/vendor/dashboard/revenue-chart').then(r => r.data),
    enabled: !loading && !!user,
    staleTime: 5 * 60_000,
  });

  const { data: recentBookingsData, isLoading: bookingsLoading } = useQuery({
    queryKey: [user?.id, 'vendor-recent-bookings'],
    queryFn: () => api.get('/vendor/bookings', { params: { limit: 5 } }).then(r => r.data),
    enabled: !loading && !!user,
    staleTime: 60_000,
  });

  const bookingsValue = Number(stats?.bookingsValue ?? 0);
  const cashRevenue = Number(stats?.totalRevenue ?? 0);
  const wanasaFunded = Number(stats?.wanasaFundedValue ?? 0);
  const statCards = [
    { title: t('vendor.dashboard.totalBookings'), value: stats?.totalBookings ?? 0, icon: CalendarCheck, detail: t('vendor.dashboard.confirmed', { count: stats?.confirmedBookings ?? 0 }) },
    {
      title: t('vendor.dashboard.bookingsValue'),
      value: stats ? 'QAR ' + bookingsValue.toFixed(0) : '—',
      icon: Receipt,
      detail: wanasaFunded > 0
        ? t('vendor.dashboard.viaWanasa', { amount: `QAR ${wanasaFunded.toFixed(0)}` })
        : t('vendor.dashboard.allTimeNominal'),
    },
    { title: t('vendor.dashboard.cashRevenue'), value: stats ? 'QAR ' + cashRevenue.toFixed(0) : '—', icon: TrendingUp, detail: t('vendor.dashboard.afterCommission') },
    { title: t('vendor.dashboard.totalActivities'), value: stats?.totalActivities ?? 0, icon: CalendarRange, detail: t('vendor.dashboard.activitiesDetail', { active: stats?.activeActivities ?? 0, pending: stats?.pendingActivities ?? 0 }) },
  ];

  const activities = recentActivities?.data ?? [];
  const recentBookings = recentBookingsData?.data ?? [];

  // Revenue chart data — memoized so child render doesn't recompute on every parent state tick.
  // bookingsValue + wanasaFundedValue enable a second (lighter) bar layer
  // showing the nominal value alongside cash revenue per month.
  const chartData: { month: string; revenue: number; bookingsValue?: number; wanasaFundedValue?: number }[] = useMemo(
    () => revenueChart ?? [],
    [revenueChart],
  );
  const maxRevenue = useMemo(
    () =>
      chartData.length > 0
        ? Math.max(...chartData.map((d) => Math.max(d.revenue, d.bookingsValue ?? 0)), 1)
        : 1,
    [chartData],
  );

  const BOOKING_STATUS_CLASSES: Record<BookingStatus, string> = {
    PENDING:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    CONFIRMED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    COMPLETED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    CANCELLED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 font-outfit text-gray-900 dark:text-white">
      <VendorSidebar />

      <main className="md:ms-64 p-4 md:p-10 overflow-x-hidden">
        <header className="flex justify-between items-center mb-10">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
              {t('vendor.dashboard.welcomeBack', { name: (user?.vendor ? localized(user.vendor, 'businessName') : '') || user?.fullName })}
            </h1>
            <p className="text-gray-500 dark:text-slate-400 mt-1">{t('vendor.dashboard.manageListings')}</p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push(`/vendor/${slug}/activities/new`)}
              className="flex items-center gap-2 px-5 py-2.5 bg-linear-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white rounded-xl font-semibold transition-all shadow-lg shadow-teal-600/20 dark:shadow-teal-900/40 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              {t('vendor.dashboard.newActivity')}
            </button>
            <div className="h-10 w-10 bg-teal-100 dark:bg-teal-900/50 border border-teal-200 dark:border-teal-800 rounded-full flex items-center justify-center font-bold text-sm text-teal-700 dark:text-teal-400">
              {((user?.vendor ? localized(user.vendor, 'businessName') : '') || user?.fullName)?.charAt(0)}
            </div>
          </div>
        </header>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
          {statCards.map(({ title, value, detail, icon: Icon }) => (
            <div
              key={title}
              className="p-6 bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 rounded-2xl hover:border-teal-300 dark:hover:border-teal-700/50 transition-all group"
            >
              {statsLoading ? (
                <div className="space-y-3">
                  <div className="h-4 w-24 bg-gray-100 dark:bg-slate-800 rounded animate-pulse" />
                  <div className="h-8 w-16 bg-gray-100 dark:bg-slate-800 rounded animate-pulse" />
                  <div className="h-3 w-20 bg-gray-100 dark:bg-slate-800 rounded animate-pulse" />
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-gray-500 dark:text-slate-400 text-sm font-medium">{title}</p>
                    <div className="h-9 w-9 rounded-xl bg-teal-50 dark:bg-teal-900/30 flex items-center justify-center">
                      <Icon className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                    </div>
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{value}</h3>
                  <p className="text-gray-400 dark:text-slate-500 text-xs mt-2">{detail}</p>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Revenue Chart */}
        <div className="bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 rounded-2xl p-6 mb-8">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-5">{t('vendor.dashboard.revenueOverview')}</h2>
          {chartLoading ? (
            <div className="h-44 bg-gray-50 dark:bg-slate-800/40 rounded-xl animate-pulse" />
          ) : chartData.length === 0 ? (
            <div className="h-44 flex items-center justify-center text-gray-400 dark:text-slate-500 text-sm">
              {t('vendor.dashboard.noRevenue')}
            </div>
          ) : (
            <div className="w-full" style={{ height: '180px' }}>
              <svg viewBox={`0 0 ${chartData.length * 80} 180`} preserveAspectRatio="xMidYMid meet" className="w-full h-full overflow-visible">
                {chartData.map((d, i) => {
                  // Two overlaid bars: the taller translucent purple bar is
                  // total Bookings Value (nominal), the solid teal bar in
                  // front is cash Revenue. A month heavy on Wanasa reads as
                  // a tall purple halo behind a short teal bar.
                  const nominal = d.bookingsValue ?? d.revenue;
                  const nominalH = Math.round((nominal / maxRevenue) * 120);
                  const cashH = Math.round((d.revenue / maxRevenue) * 120);
                  const x = i * 80 + 10;
                  const yNominal = 140 - nominalH;
                  const yCash = 140 - cashH;
                  return (
                    <g key={d.month}>
                      {/* Nominal bar (lighter, behind) — only when bookingsValue > revenue */}
                      {nominal > d.revenue && (
                        <rect
                          x={x}
                          y={yNominal}
                          width={52}
                          height={nominalH}
                          rx={6}
                          className="fill-purple-300 dark:fill-purple-500/60"
                        />
                      )}
                      {/* Cash revenue bar (solid teal, front) */}
                      <rect
                        x={x}
                        y={yCash}
                        width={52}
                        height={cashH}
                        rx={6}
                        className="fill-teal-500 dark:fill-teal-600 opacity-85 hover:opacity-100 transition-opacity"
                      />
                      {/* Label above whichever bar is taller */}
                      {nominal > 0 && (
                        <text
                          x={x + 26}
                          y={(nominal > d.revenue ? yNominal : yCash) - 6}
                          textAnchor="middle"
                          className="fill-gray-600 dark:fill-slate-400"
                          style={{ fontSize: '10px', fontFamily: 'Outfit, sans-serif' }}
                        >
                          {nominal >= 1000 ? `${(nominal / 1000).toFixed(1)}k` : nominal}
                        </text>
                      )}
                      {/* Month label below bar */}
                      <text
                        x={x + 26}
                        y={158}
                        textAnchor="middle"
                        className="fill-gray-400 dark:fill-slate-500"
                        style={{ fontSize: '11px', fontFamily: 'Outfit, sans-serif' }}
                      >
                        {d.month}
                      </text>
                    </g>
                  );
                })}
              </svg>
              {/* Legend */}
              <div className="flex items-center justify-center gap-5 text-[11px] text-gray-500 dark:text-slate-400 mt-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-3 h-2.5 rounded-sm bg-teal-500" />
                  {t('vendor.dashboard.legendCash')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-3 h-2.5 rounded-sm bg-purple-300 dark:bg-purple-500/60" />
                  {t('vendor.dashboard.legendBookings')}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Two-column grid: Recent Bookings + Recent Activities */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Recent Bookings */}
          <div className="bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 rounded-2xl">
            <div className="flex justify-between items-center px-6 py-5 border-b border-gray-100 dark:border-slate-800">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t('vendor.dashboard.recentBookings')}</h2>
              <button
                onClick={() => router.push(`/vendor/${slug}/bookings`)}
                className="flex items-center gap-1 text-teal-600 dark:text-teal-400 text-sm font-semibold hover:underline"
              >
                {t('vendor.dashboard.viewAll')} <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            {bookingsLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-14 bg-gray-100 dark:bg-slate-800 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : recentBookings.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CalendarCheck className="h-8 w-8 text-gray-300 dark:text-slate-600 mb-2" />
                <p className="text-sm text-gray-400 dark:text-slate-500">{t('vendor.dashboard.noBookings')}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-50 dark:border-slate-800/50">
                      <th className="text-start px-6 py-3 text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase">{t('vendor.dashboard.thCustomer')}</th>
                      <th className="text-start px-6 py-3 text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase">{t('vendor.dashboard.thActivity')}</th>
                      <th className="text-start px-6 py-3 text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase">{t('vendor.dashboard.thDate')}</th>
                      <th className="text-start px-6 py-3 text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase">{t('vendor.dashboard.thAmount')}</th>
                      <th className="text-start px-6 py-3 text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase">{t('vendor.dashboard.thStatus')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentBookings.map((b: any) => {
                      const statusClass = pickBadge(BOOKING_STATUS_CLASSES, b.status, BOOKING_STATUS_CLASSES.PENDING);
                      // Nominal = totalPrice + couponDiscount. Under the
                      // new accounting, totalPrice already carries the full
                      // vendor value for every payment method (cash, Wanasa,
                      // mixed), so we only add couponDiscount back.
                      const nominal = Number(b.totalPrice || 0) + Number(b.couponDiscount || 0);
                      const pts = Number(b.pointsRedeemed || 0);
                      const isWanasa = b.payment?.method === 'WANASA_POINTS';
                      return (
                        <tr key={b.id} className="border-b border-gray-50 dark:border-slate-800/50 last:border-0 hover:bg-gray-50/50 dark:hover:bg-slate-800/20 transition-colors">
                          <td className="px-6 py-3 text-sm text-gray-900 dark:text-white">{b.customer?.fullName}</td>
                          <td className="px-6 py-3 text-xs text-gray-500 dark:text-slate-400 max-w-[100px] truncate">{localized(b.activity, 'title')}</td>
                          <td className="px-6 py-3 text-xs text-gray-500 dark:text-slate-400">{new Date(b.startDatetime).toLocaleDateString(undefined, { timeZone: 'UTC' })}</td>
                          <td className="px-6 py-3">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-sm font-medium text-gray-900 dark:text-white">
                                {b.currencyCode || 'QAR'} {nominal.toFixed(0)}
                              </span>
                              {isWanasa ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-purple-600 dark:text-purple-400 w-fit">
                                  <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
                                  Wanasa
                                </span>
                              ) : pts > 0 ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-purple-600 dark:text-purple-400 w-fit">
                                  <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
                                  {t('vendor.dashboard.pts', { count: pts.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-6 py-3">
                            <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${statusClass}`}>{bookingStatusLabel(t, b.status)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recent Activities */}
          <div className="bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 rounded-2xl">
            <div className="flex justify-between items-center px-6 py-5 border-b border-gray-100 dark:border-slate-800">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t('vendor.dashboard.recentActivities')}</h2>
              <button
                onClick={() => router.push(`/vendor/${slug}/activities`)}
                className="flex items-center gap-1 text-teal-600 dark:text-teal-400 text-sm font-semibold hover:underline"
              >
                {t('vendor.dashboard.viewAll')} <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {activitiesLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-14 bg-gray-100 dark:bg-slate-800 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : activities.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-12 h-12 mb-3 rounded-2xl bg-teal-50 dark:bg-teal-900/30 flex items-center justify-center">
                  <Activity className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                </div>
                <p className="text-sm font-medium text-gray-600 dark:text-slate-300">{t('vendor.dashboard.noActivities')}</p>
                <button
                  onClick={() => router.push(`/vendor/${slug}/activities/new`)}
                  className="mt-3 flex items-center gap-2 px-4 py-2 bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 rounded-xl text-sm font-medium hover:bg-teal-100 dark:hover:bg-teal-900/50 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  {t('vendor.dashboard.createActivity')}
                </button>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-slate-800/50">
                {activities.map((activity: any) => {
                  const ACTIVITY_STATUS_CLASSES: Record<ActivityStatus, string> = {
                    PENDING:  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                    ACTIVE:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
                    INACTIVE: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400',
                    BLOCKED:  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                  };
                  const statusClass = pickBadge(ACTIVITY_STATUS_CLASSES, activity.status, ACTIVITY_STATUS_CLASSES.PENDING);
                  const statusLabel = t(`vendor.dashboard.activityStatus.${activity.status}`, { defaultValue: activity.status });
                  return (
                    <div
                      key={activity.id}
                      onClick={() => router.push(`/vendor/${slug}/activities/${activity.slug}`)}
                      className="flex items-center justify-between px-6 py-4 hover:bg-gray-50/50 dark:hover:bg-slate-800/30 cursor-pointer transition-colors"
                    >
                      <div>
                        <p className="font-medium text-sm text-gray-900 dark:text-white">{localized(activity, 'title')}</p>
                        <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
                          {localized(activity.category, 'name')} &middot; QAR {Number(activity.pricePerPerson).toFixed(0)}
                        </p>
                      </div>
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${statusClass}`}>
                        {statusLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
