'use client';

import { useMemo } from 'react';
import { useAuth } from '@/context/auth-context';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/lib/api';
import { localized } from '@/lib/localize';
import { VendorSidebar } from '../../_components/vendor-sidebar';
import {
  Star,
  Heart,
  BookOpen,
  DollarSign,
  TrendingUp,
  Info,
  Calendar,
  Activity,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

interface ActivityStat {
  id: string;
  titleEn: string;
  status: string;
  price: number;
  bookings: number;
  reviews: number;
  likes: number;
  revenue: number;
  avgRating: number;
}

interface MonthlyRevenue {
  month: string;
  revenue: number;
}

function KpiCard({
  label,
  value,
  icon: Icon,
  accent,
  sub,
  tooltip,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  accent: { fg: string; bg: string; ring: string };
  sub?: string;
  tooltip?: string;
}) {
  return (
    <div className="group relative p-5 rounded-2xl border border-gray-200/80 dark:border-slate-800/70 bg-white dark:bg-slate-900/60 hover:border-teal-300 dark:hover:border-teal-700/50 transition-colors">
      <div className="flex items-start justify-between mb-4">
        <div className={`h-11 w-11 rounded-xl ${accent.bg} flex items-center justify-center ring-1 ${accent.ring}`}>
          <Icon className={`h-5 w-5 ${accent.fg}`} aria-hidden="true" />
        </div>
        {tooltip ? (
          <span className="inline-flex" title={tooltip}>
            <Info className="h-3.5 w-3.5 text-gray-300 dark:text-slate-600 group-hover:text-gray-400 dark:group-hover:text-slate-500 transition-colors" aria-hidden="true" />
          </span>
        ) : null}
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums text-gray-900 dark:text-white">{value}</p>
      {sub ? <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{sub}</p> : null}
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="p-5 rounded-2xl border border-gray-200/80 dark:border-slate-800/70 bg-white dark:bg-slate-900/60 animate-pulse">
      <div className="h-11 w-11 rounded-xl bg-gray-100 dark:bg-slate-800 mb-4" />
      <div className="h-3 w-20 bg-gray-100 dark:bg-slate-800 rounded mb-2" />
      <div className="h-6 w-24 bg-gray-100 dark:bg-slate-800 rounded" />
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
  className = '',
  action,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border border-gray-200/80 dark:border-slate-800/70 bg-white dark:bg-slate-900/60 ${className}`}>
      <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-gray-100 dark:border-slate-800/60">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white">{title}</h2>
          {subtitle ? <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

export default function VendorAnalyticsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const { data: activities = [], isLoading } = useQuery<ActivityStat[]>({
    queryKey: [user?.id, 'vendor-activity-analytics'],
    queryFn: () => api.get('/vendor/analytics/activities').then((r) => r.data),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  const { data: revenueChart = [], isLoading: chartLoading } = useQuery<MonthlyRevenue[]>({
    queryKey: [user?.id, 'vendor-revenue-chart'],
    queryFn: () => api.get('/vendor/dashboard/revenue-chart').then((r) => r.data),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  const { totalBookings, totalRevenue, totalReviews, totalLikes, weightedRating } = useMemo(() => {
    let tb = 0,
      tr = 0,
      trev = 0,
      tl = 0;
    let ratingSum = 0,
      ratingCount = 0;
    for (const a of activities) {
      tb += a.bookings;
      tr += a.revenue;
      trev += a.reviews;
      tl += a.likes;
      if (a.avgRating > 0 && a.reviews > 0) {
        ratingSum += a.avgRating * a.reviews;
        ratingCount += a.reviews;
      }
    }
    const avg = ratingCount > 0 ? ratingSum / ratingCount : 0;
    return {
      totalBookings: tb,
      totalRevenue: tr,
      totalReviews: trev,
      totalLikes: tl,
      weightedRating: avg,
    };
  }, [activities]);

  const topActivity = useMemo(() => {
    if (activities.length === 0) return null;
    return [...activities].sort((a, b) => b.revenue - a.revenue)[0];
  }, [activities]);

  const maxActivityRevenue = useMemo(() => Math.max(...activities.map((a) => a.revenue), 1), [activities]);

  const activityStatusAria = (status: string) => t(`vendor.dashboard.activityStatus.${status}`, { defaultValue: status });

  function RevenueTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    const revenue = (payload as { dataKey?: string; value?: number }[]).find((p) => p.dataKey === 'revenue')?.value ?? 0;
    return (
      <div className="rounded-xl border border-gray-200/80 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl px-3.5 py-2.5 min-w-[160px]">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-1.5">
          {t('vendor.analytics.chart.tooltipMonth', { label: label ?? '' })}
        </p>
        <div className="flex items-center justify-between gap-4 text-xs">
          <span className="inline-flex items-center gap-1.5 text-gray-600 dark:text-slate-300">
            <span className="w-2 h-2 rounded-sm bg-teal-500" />
            {t('vendor.analytics.chart.tooltipCashRevenue')}
          </span>
          <span className="font-semibold tabular-nums text-gray-900 dark:text-white">
            {t('vendor.analytics.chart.tooltipAmount', { amount: Number(revenue).toFixed(0) })}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 font-outfit text-gray-900 dark:text-white">
      <VendorSidebar />

      <main className="md:ms-64 p-4 max-md:pt-16 md:p-6 lg:p-10 overflow-x-hidden">
        <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t('vendor.analytics.title')}</h1>
            <p className="text-gray-500 dark:text-slate-400 mt-1 text-sm">{t('vendor.analytics.subtitle')}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {isLoading ? (
            <>
              {Array.from({ length: 3 }).map((_, i) => (
                <KpiSkeleton key={i} />
              ))}
            </>
          ) : (
            <>
              <KpiCard
                label={t('vendor.analytics.kpi.cashRevenue')}
                value={t('vendor.analytics.kpi.cashRevenueValue', { amount: totalRevenue.toFixed(0) })}
                icon={DollarSign}
                accent={{ fg: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/20' }}
                sub={t('vendor.analytics.kpi.cashRevenueSub', {
                  defaultValue: 'Withdrawable via payout (after commission)',
                })}
                tooltip={t('vendor.analytics.kpi.cashRevenueTooltip', {
                  defaultValue: 'Your post-commission revenue across all successful bookings.',
                })}
              />
              <KpiCard
                label={t('vendor.analytics.kpi.totalBookings')}
                value={totalBookings.toLocaleString()}
                icon={BookOpen}
                accent={{ fg: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10', ring: 'ring-blue-500/20' }}
                sub={
                  activities.length === 1
                    ? t('vendor.analytics.kpi.bookingsSubOne')
                    : t('vendor.analytics.kpi.bookingsSubMany', { count: activities.length })
                }
              />
              <KpiCard
                label={t('vendor.analytics.kpi.avgRating')}
                value={weightedRating > 0 ? weightedRating.toFixed(2) : t('vendor.analytics.kpi.dash')}
                icon={Star}
                accent={{ fg: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10', ring: 'ring-amber-500/20' }}
                sub={
                  totalReviews === 1
                    ? t('vendor.analytics.kpi.reviewsSubOne')
                    : t('vendor.analytics.kpi.reviewsSubMany', { count: totalReviews })
                }
                tooltip={t('vendor.analytics.kpi.avgRatingTooltip', {
                  defaultValue:
                    'Weighted across all your activities by review count — a 5.0 with 1 review does not outweigh a 4.6 with 200.',
                })}
              />
            </>
          )}
        </div>

        <div className="mb-6">
          <ChartCard title={t('vendor.analytics.chart.revenueTrendTitle')} subtitle={t('vendor.analytics.chart.revenueTrendSubtitle')}>
            {chartLoading ? (
              <div className="h-64 bg-gray-50 dark:bg-slate-800/40 rounded-xl animate-pulse" />
            ) : revenueChart.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-center gap-2">
                <TrendingUp className="h-8 w-8 text-gray-300 dark:text-slate-600" aria-hidden="true" />
                <p className="text-sm text-gray-500 dark:text-slate-400">{t('vendor.analytics.chart.noData')}</p>
              </div>
            ) : (
              <div className="w-full h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="areaCash" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#14b8a6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-200 dark:text-slate-800" vertical={false} />
                    <XAxis
                      dataKey="month"
                      stroke="currentColor"
                      className="text-gray-400 dark:text-slate-500"
                      tick={{ fontSize: 11, fontFamily: 'Outfit, sans-serif' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="currentColor"
                      className="text-gray-400 dark:text-slate-500"
                      tick={{ fontSize: 11, fontFamily: 'Outfit, sans-serif' }}
                      axisLine={false}
                      tickLine={false}
                      width={40}
                    />
                    <Tooltip content={RevenueTooltip} />
                    <Area type="monotone" dataKey="revenue" stroke="#14b8a6" strokeWidth={2} fill="url(#areaCash)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="p-5 rounded-2xl border border-gray-200/80 dark:border-slate-800/70 bg-white dark:bg-slate-900/60">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-teal-500" aria-hidden="true" />
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">{t('vendor.analytics.starPerformer')}</p>
            </div>
            {topActivity ? (
              <>
                <p className="text-base font-bold text-gray-900 dark:text-white truncate">{localized(topActivity, 'title')}</p>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                  {t('vendor.analytics.topActivityMeta', {
                    bookings: topActivity.bookings,
                    revenue: topActivity.revenue.toFixed(0),
                  })}
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-400 dark:text-slate-500">{t('vendor.analytics.noActivitiesShort')}</p>
            )}
          </div>
          <div className="p-5 rounded-2xl border border-gray-200/80 dark:border-slate-800/70 bg-white dark:bg-slate-900/60">
            <div className="flex items-center gap-2 mb-3">
              <Heart className="h-4 w-4 text-red-500" aria-hidden="true" />
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">{t('vendor.analytics.totalLikes')}</p>
            </div>
            <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{totalLikes.toLocaleString()}</p>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{t('vendor.analytics.likesSub')}</p>
          </div>
        </div>

        <ChartCard title={t('vendor.analytics.tableTitle')} subtitle={t('vendor.analytics.tableSubtitle')}>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-gray-100 dark:bg-slate-800/60 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : activities.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center gap-2">
              <Activity className="h-10 w-10 text-gray-300 dark:text-slate-600" aria-hidden="true" />
              <p className="text-sm font-medium text-gray-600 dark:text-slate-300">{t('vendor.analytics.emptyTitle')}</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">{t('vendor.analytics.emptySubtitle')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-slate-800/60">
                    <th className="text-start px-2 py-3 text-[10px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">
                      {t('vendor.analytics.thActivity')}
                    </th>
                    <th className="text-start px-2 py-3 text-[10px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">
                      {t('vendor.analytics.thBookings')}
                    </th>
                    <th className="text-start px-2 py-3 text-[10px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">
                      {t('vendor.analytics.thCashRevenue')}
                    </th>
                    <th className="text-start px-2 py-3 text-[10px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">
                      {t('vendor.analytics.thRating')}
                    </th>
                    <th className="text-start px-2 py-3 text-[10px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">
                      {t('vendor.analytics.thEngagement')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a) => {
                    const pct = (a.revenue / maxActivityRevenue) * 100;
                    return (
                      <tr
                        key={a.id}
                        className="border-b border-gray-50 dark:border-slate-800/50 hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors"
                      >
                        <td className="px-2 py-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                a.status === 'ACTIVE' ? 'bg-emerald-500' : a.status === 'PENDING' ? 'bg-amber-500' : 'bg-gray-400'
                              }`}
                              aria-label={activityStatusAria(a.status)}
                            />
                            <p className="font-medium text-gray-900 dark:text-white max-w-[220px] truncate">{localized(a, 'title')}</p>
                          </div>
                        </td>
                        <td className="px-2 py-3 font-medium text-gray-900 dark:text-white">{a.bookings}</td>
                        <td className="px-2 py-3">
                          <div className="flex flex-col gap-1 min-w-[160px]">
                            <span className="font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">
                              {t('vendor.analytics.chart.tooltipAmount', { amount: a.revenue.toFixed(0) })}
                            </span>
                            <div className="h-1.5 w-full bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                              <div className="h-full bg-teal-500" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-3">
                          {a.avgRating > 0 ? (
                            <span className="inline-flex items-center gap-1 text-sm">
                              <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" aria-hidden="true" />
                              <span className="font-medium text-gray-900 dark:text-white tabular-nums">{a.avgRating.toFixed(1)}</span>
                              <span className="text-xs text-gray-400 dark:text-slate-500">· {a.reviews}</span>
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400 dark:text-slate-500">{t('vendor.analytics.noRating')}</span>
                          )}
                        </td>
                        <td className="px-2 py-3">
                          <span className="inline-flex items-center gap-3 text-xs text-gray-500 dark:text-slate-400">
                            <span className="inline-flex items-center gap-1">
                              <Heart className="h-3 w-3 text-red-500" aria-hidden="true" />
                              {a.likes}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="h-3 w-3" aria-hidden="true" />
                              {a.bookings}
                            </span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </main>
    </div>
  );
}
