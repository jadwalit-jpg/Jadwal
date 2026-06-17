'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/auth-context';
import api from '@/lib/api';
import Link from 'next/link';
import AdminLayout from '../_components/admin-layout';
import {
  Users,
  Store,
  CalendarRange,
  BookOpen,
  DollarSign,
  Shield,
  Sparkles,
  Percent,
  Banknote,
  Wallet,
  Coins,
  ChevronRight,
  Gift,
  Download,
  TrendingUp,
  AlertTriangle,
  Receipt,
} from 'lucide-react';
import type { MonthlyRevenue } from './_components/revenue-area-chart';

const RevenueAreaChart = dynamic(
  () => import('./_components/revenue-area-chart'),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-40 rounded-lg bg-gray-200 dark:bg-white/5 animate-pulse" aria-hidden="true" />
    ),
  },
);

// ─── Types ─────────────────────────────────────────────────────

interface DashboardStats {
  totalUsers: number;
  totalVendors: number;
  activeVendors: number;
  pendingVendors: number;
  totalActivities: number;
  pendingActivities: number;
  totalBookings: number;
  confirmedBookings: number;
  totalRevenue: number;
  bookingsValue?: number;
  wanasaFundedValue?: number;
  totalCommission?: number;
  totalServiceFees?: number;
  pendingPayoutOwed?: number;
  totalPointsIssued?: number;
  refundPendingCount?: number;
  refundPendingAmount?: number;
}

interface ChartsData {
  revenueByMonth: Record<string, number>;
  vendorsByMonth: Record<string, number>;
  topActivities: { name: string; category: string; bookings: number; revenue?: number }[];
}

function padToLast6Months(
  map?: Record<string, number>,
): { key: string; value: number }[] {
  const out: { key: string; value: number }[] = [];
  const now = new Date();
  for (let offset = 5; offset >= 0; offset--) {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ key, value: Number(map?.[key] ?? 0) });
  }
  return out;
}

function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

// ─── Skeleton ──────────────────────────────────────────────────

function StatSkeleton() {
  return (
    <div className="bg-white dark:bg-slate-950 p-6 space-y-2">
      <div className="h-2.5 w-20 bg-gray-200 dark:bg-white/5 rounded animate-pulse" />
      <div className="h-8 w-28 bg-gray-200 dark:bg-white/5 rounded animate-pulse" />
      <div className="h-2 w-16 bg-gray-200 dark:bg-white/5 rounded animate-pulse" />
    </div>
  );
}

// ─── Top activities table ───────────────────────────────────────

function TopActivitiesTable({ items }: { items: ChartsData['topActivities'] }) {
  if (!items.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <div className="h-10 w-10 rounded-xl bg-gray-100 dark:bg-white/5 flex items-center justify-center text-gray-400 dark:text-slate-600">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium text-gray-500 dark:text-slate-400">No activities yet</p>
        <p className="text-xs text-gray-400 dark:text-slate-600 max-w-[220px]">Once vendors list activities and get bookings, leaders will show here.</p>
      </div>
    );
  }
  return (
    <div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-4 pb-2 border-b border-gray-200 dark:border-white/5 text-[11px] uppercase tracking-widest text-gray-400 dark:text-slate-600">
        <span>Activity</span>
        <span>Bookings</span>
        <span>Revenue</span>
      </div>
      {items.slice(0, 5).map((a, i) => (
        <div
          key={i}
          className={`grid grid-cols-[1fr_auto_auto] gap-4 py-3 text-sm items-center ${i < Math.min(items.length, 5) - 1 ? 'border-b border-gray-100 dark:border-white/4' : ''}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-bold text-gray-300 dark:text-slate-700 w-4 shrink-0">{i + 1}</span>
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 dark:text-white truncate">{a.name}</p>
              <p className="text-[11px] text-gray-500 dark:text-slate-500 truncate">{a.category}</p>
            </div>
          </div>
          <span className="text-gray-500 dark:text-slate-400 tabular-nums text-end">{a.bookings}</span>
          <span className="text-gray-700 dark:text-slate-300 font-semibold tabular-nums text-end">
            QAR {Number(a.revenue ?? 0).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const { user } = useAuth();

  const [range, setRange] = useState<'30' | '60' | '90' | 'all'>('30');
  const periodLabel = range === 'all' ? 'all time' : `last ${range}d`;

  const { data: stats, isLoading, dataUpdatedAt } = useQuery<DashboardStats>({
    queryKey: ['admin', 'dashboard-stats', range],
    queryFn: async () => {
      const { data } = await api.get('/admin/dashboard/stats', { params: { range } });
      return data;
    },
    staleTime: 60_000,
  });

  const { data: charts } = useQuery<ChartsData>({
    queryKey: ['admin', 'dashboard-charts'],
    queryFn: async () => {
      const { data } = await api.get('/admin/dashboard/charts');
      return data;
    },
    staleTime: 60_000,
  });

  const revenueSeries: MonthlyRevenue[] = useMemo(
    () =>
      padToLast6Months(charts?.revenueByMonth).map(({ key, value }) => ({
        month: monthLabel(key),
        revenue: value,
      })),
    [charts],
  );

  const syncLabel = useMemo(() => {
    if (!dataUpdatedAt) return 'syncing…';
    const diffSec = Math.floor((Date.now() - dataUpdatedAt) / 1000);
    if (diffSec < 60) return 'just now';
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) return `${mins} min ago`;
    return `${Math.floor(mins / 60)} hr ago`;
  }, [dataUpdatedAt]);

  const todayLabel = useMemo(
    () => new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    [],
  );

  const loyaltyCap = Number(process.env.NEXT_PUBLIC_LOYALTY_DISPLAY_CAP || 100000);
  const pointsIssued = Number(stats?.totalPointsIssued ?? 0);
  const pointsWorthQar = useMemo(() => {
    const qarPerPoint = Number(process.env.NEXT_PUBLIC_LOYALTY_QAR_PER_POINT || 0.01);
    return Math.round(pointsIssued * qarPerPoint);
  }, [pointsIssued]);
  const loyaltyPct = loyaltyCap > 0 ? Math.min(100, Math.round((pointsIssued / loyaltyCap) * 100)) : 0;

  const totalActionItems = (stats?.pendingVendors ?? 0) + (stats?.pendingActivities ?? 0) + (stats?.refundPendingCount ?? 0);

  return (
    <AdminLayout title="Platform Dashboard">

      {/* ─── Greeting + Period selector ────────────────────── */}
      <div className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm text-gray-500 dark:text-slate-500">
            Welcome back{user?.fullName ? `, ${user.fullName.split(' ')[0]}` : ''} · {todayLabel}
          </p>
          <div className="flex items-center gap-3 mt-1.5 text-sm">
            <span className="inline-flex items-center gap-2 text-gray-700 dark:text-slate-300">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              All systems operational
            </span>
            <span className="text-gray-300 dark:text-slate-700">·</span>
            <span className="text-gray-500 dark:text-slate-500">Last sync {syncLabel}</span>
          </div>
        </div>
        <div className="inline-flex items-center gap-0.5 rounded-xl border border-gray-200 dark:border-white/5 bg-gray-100 dark:bg-white/3 p-1">
          {(['30', '60', '90', 'all'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                range === r
                  ? 'bg-sky-500 text-white'
                  : 'text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {r === 'all' ? 'All' : `${r}d`}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Hero stats strip ──────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-gray-200 dark:bg-white/5 rounded-2xl overflow-hidden mb-8">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)
        ) : (
          <>
            {/* Cash Revenue */}
            <div className="bg-white dark:bg-slate-950 p-6">
              <p className="text-[11px] uppercase tracking-widest text-gray-500 dark:text-slate-500 mb-2 flex items-center gap-1.5">
                <DollarSign className="h-3 w-3" aria-hidden="true" /> Cash Revenue
              </p>
              <p className="text-3xl font-black tracking-tight">
                {Number(stats?.totalRevenue ?? 0).toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">QAR · {periodLabel}</p>
            </div>

            {/* Total Bookings */}
            <div className="bg-white dark:bg-slate-950 p-6">
              <p className="text-[11px] uppercase tracking-widest text-gray-500 dark:text-slate-500 mb-2 flex items-center gap-1.5">
                <BookOpen className="h-3 w-3" aria-hidden="true" /> Bookings
              </p>
              <p className="text-3xl font-black tracking-tight">
                {Number(stats?.totalBookings ?? 0).toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">
                {Number(stats?.confirmedBookings ?? 0).toLocaleString()} confirmed · {periodLabel}
              </p>
            </div>

            {/* Active Vendors */}
            <div className="bg-white dark:bg-slate-950 p-6">
              <p className="text-[11px] uppercase tracking-widest text-gray-500 dark:text-slate-500 mb-2 flex items-center gap-1.5">
                <Store className="h-3 w-3" aria-hidden="true" /> Active Vendors
              </p>
              <p className="text-3xl font-black tracking-tight">
                {stats?.activeVendors ?? 0}
              </p>
              {(stats?.pendingVendors ?? 0) > 0 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  {stats?.pendingVendors} pending approval
                </p>
              ) : (
                <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">All verified</p>
              )}
            </div>

            {/* Total Users */}
            <div className="bg-white dark:bg-slate-950 p-6">
              <p className="text-[11px] uppercase tracking-widest text-gray-500 dark:text-slate-500 mb-2 flex items-center gap-1.5">
                <Users className="h-3 w-3" aria-hidden="true" /> Total Users
              </p>
              <p className="text-3xl font-black tracking-tight">
                {Number(stats?.totalUsers ?? 0).toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">
                {stats?.totalActivities ?? 0} activities listed
              </p>
            </div>
          </>
        )}
      </div>

      {/* ─── Main 2-column grid ────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">

        {/* ── Left column ─────────────────────────────────── */}
        <div className="space-y-6">

          {/* Revenue chart card + financial breakdown */}
          <div className="rounded-2xl bg-white dark:bg-white/3 border border-gray-200 dark:border-white/5 p-6">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">Revenue Overview</h2>
                <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5">Cash settled · last 6 months</p>
              </div>
              <div className="flex items-center gap-1">
                <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  QAR {Number(stats?.totalRevenue ?? 0).toLocaleString()}
                </span>
              </div>
            </div>

            <RevenueAreaChart data={revenueSeries} />

            {/* Financial breakdown below chart */}
            <div className="grid grid-cols-3 gap-4 mt-6 pt-5 border-t border-gray-200 dark:border-white/5">
              <div>
                <p className="text-[11px] text-gray-500 dark:text-slate-500 uppercase tracking-widest flex items-center gap-1">
                  <Percent className="h-3 w-3" aria-hidden="true" /> Commission
                </p>
                <p className="text-lg font-black mt-1 tracking-tight">
                  QAR {Number(stats?.totalCommission ?? 0).toLocaleString()}
                </p>
                <p className="text-[11px] text-gray-400 dark:text-slate-600">{periodLabel}</p>
              </div>
              <div>
                <p className="text-[11px] text-gray-500 dark:text-slate-500 uppercase tracking-widest flex items-center gap-1">
                  <Banknote className="h-3 w-3" aria-hidden="true" /> Service fees
                </p>
                <p className="text-lg font-black mt-1 tracking-tight">
                  QAR {Number(stats?.totalServiceFees ?? 0).toLocaleString()}
                </p>
                <p className="text-[11px] text-gray-400 dark:text-slate-600">{periodLabel}</p>
              </div>
              <div>
                <p className="text-[11px] text-gray-500 dark:text-slate-500 uppercase tracking-widest flex items-center gap-1">
                  <Wallet className="h-3 w-3" aria-hidden="true" /> Vendor owed
                </p>
                <p className="text-lg font-black mt-1 tracking-tight text-amber-600 dark:text-amber-400">
                  QAR {Number(stats?.pendingPayoutOwed ?? 0).toLocaleString()}
                </p>
                <p className="text-[11px] text-gray-400 dark:text-slate-600">pending payout</p>
              </div>
            </div>
          </div>

          {/* Top activities table */}
          <div className="rounded-2xl bg-white dark:bg-white/3 border border-gray-200 dark:border-white/5 p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">Top Activities</h2>
                <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5">By bookings · non-cancelled</p>
              </div>
              <Link
                href="/admin/activities"
                className="text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300 transition-colors flex items-center gap-0.5"
              >
                View all <ChevronRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            </div>
            <TopActivitiesTable items={charts?.topActivities ?? []} />
          </div>
        </div>

        {/* ── Right column ────────────────────────────────── */}
        <div className="space-y-5">

          {/* Action queue */}
          <div className="rounded-2xl bg-white dark:bg-white/3 border border-gray-200 dark:border-white/5 overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between border-b border-gray-200 dark:border-white/5">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Action Required</h2>
              {totalActionItems > 0 ? (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  {totalActionItems}
                </span>
              ) : (
                <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">All clear</span>
              )}
            </div>

            {/* Vendor verifications */}
            <Link
              href="/admin/vendors"
              className="flex items-center gap-4 px-5 py-4 border-b border-gray-100 dark:border-white/4 hover:bg-gray-50 dark:hover:bg-white/3 transition-colors group"
            >
              <div className={`h-9 w-9 shrink-0 rounded-xl flex items-center justify-center ${(stats?.pendingVendors ?? 0) > 0 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-slate-600'}`}>
                <Shield className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">Vendor verifications</p>
                <p className="text-xs text-gray-500 dark:text-slate-500">KYC awaiting review</p>
              </div>
              <span className={`text-lg font-black ${(stats?.pendingVendors ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-300 dark:text-slate-700'}`}>
                {stats?.pendingVendors ?? 0}
              </span>
              <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 dark:text-slate-700 dark:group-hover:text-slate-400 transition-colors" aria-hidden="true" />
            </Link>

            {/* Activity moderation */}
            <Link
              href="/admin/activities"
              className="flex items-center gap-4 px-5 py-4 border-b border-gray-100 dark:border-white/4 hover:bg-gray-50 dark:hover:bg-white/3 transition-colors group"
            >
              <div className={`h-9 w-9 shrink-0 rounded-xl flex items-center justify-center ${(stats?.pendingActivities ?? 0) > 0 ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400' : 'bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-slate-600'}`}>
                <CalendarRange className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">Activity moderation</p>
                <p className="text-xs text-gray-500 dark:text-slate-500">Listings awaiting review</p>
              </div>
              <span className={`text-lg font-black ${(stats?.pendingActivities ?? 0) > 0 ? 'text-sky-600 dark:text-sky-400' : 'text-gray-300 dark:text-slate-700'}`}>
                {stats?.pendingActivities ?? 0}
              </span>
              <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 dark:text-slate-700 dark:group-hover:text-slate-400 transition-colors" aria-hidden="true" />
            </Link>

            {/* Refunds */}
            <Link
              href="/admin/bookings"
              className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 dark:hover:bg-white/3 transition-colors group"
            >
              <div className={`h-9 w-9 shrink-0 rounded-xl flex items-center justify-center ${(stats?.refundPendingCount ?? 0) > 0 ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-gray-100 dark:bg-white/5 text-gray-300 dark:text-slate-700'}`}>
                <Receipt className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${(stats?.refundPendingCount ?? 0) > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-slate-600'}`}>
                  Refund requests
                </p>
                <p className="text-xs text-gray-400 dark:text-slate-600">
                  {(stats?.refundPendingCount ?? 0) > 0
                    ? `QAR ${Number(stats?.refundPendingAmount ?? 0).toLocaleString()} queued`
                    : 'Nothing queued'}
                </p>
              </div>
              <span className={`text-lg font-black ${(stats?.refundPendingCount ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-300 dark:text-slate-800'}`}>
                {stats?.refundPendingCount ?? 0}
              </span>
              <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 dark:text-slate-800 dark:group-hover:text-slate-600 transition-colors" aria-hidden="true" />
            </Link>
          </div>

          {/* Loyalty liability */}
          <div className="rounded-2xl bg-white dark:bg-white/3 border border-gray-200 dark:border-white/5 p-5">
            <div className="flex items-center gap-1.5 mb-3">
              <Coins className="h-3.5 w-3.5 text-yellow-500 dark:text-yellow-400" aria-hidden="true" />
              <p className="text-[11px] uppercase tracking-widest text-gray-500 dark:text-slate-500">Loyalty liability</p>
            </div>
            <div className="flex items-end justify-between mb-3">
              <div>
                <p className="text-2xl font-black tracking-tight">
                  {pointsIssued.toLocaleString()}
                  <span className="text-sm font-normal text-gray-500 dark:text-slate-500 ms-1.5">pts</span>
                </p>
                <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5">≈ QAR {pointsWorthQar.toLocaleString()} exposure</p>
              </div>
              <span className="text-sm font-bold text-yellow-600 dark:text-yellow-400">{loyaltyPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-gray-200 dark:bg-white/5 overflow-hidden">
              <div
                className="h-full rounded-full bg-linear-to-r from-yellow-500 to-amber-400 transition-all duration-700"
                style={{ width: `${loyaltyPct}%` }}
              />
            </div>
            <p className="text-[11px] text-gray-400 dark:text-slate-700 mt-1.5">
              {pointsIssued.toLocaleString()} of {loyaltyCap.toLocaleString()} cap
            </p>
          </div>

          {/* Bookings value + Wanasa funded mini stats */}
          <div className="grid grid-cols-2 gap-px bg-gray-200 dark:bg-white/5 rounded-2xl overflow-hidden">
            <div className="bg-white dark:bg-slate-950 p-5">
              <p className="text-[11px] uppercase tracking-widest text-gray-500 dark:text-slate-500 mb-1">Bookings value</p>
              <p className="text-xl font-black tracking-tight">
                QAR {Number(stats?.bookingsValue ?? 0).toLocaleString()}
              </p>
              <p className="text-[11px] text-gray-400 dark:text-slate-600 mt-0.5">Cash + points + coupons</p>
            </div>
            <div className="bg-white dark:bg-slate-950 p-5">
              <p className="text-[11px] uppercase tracking-widest text-gray-500 dark:text-slate-500 mb-1">Wanasa funded</p>
              <p className="text-xl font-black tracking-tight text-yellow-600 dark:text-yellow-400">
                QAR {Number(stats?.wanasaFundedValue ?? 0).toLocaleString()}
              </p>
              <p className="text-[11px] text-gray-400 dark:text-slate-600 mt-0.5">Paid via points</p>
            </div>
          </div>

          {/* Quick actions */}
          <div className="rounded-2xl bg-white dark:bg-white/3 border border-gray-200 dark:border-white/5 p-5">
            <p className="text-[11px] uppercase tracking-widest text-gray-500 dark:text-slate-500 mb-4">Quick actions</p>
            <div className="space-y-1">
              <Link
                href="/admin/vendors"
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group"
              >
                <div className="h-8 w-8 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                  <Store className="h-4 w-4" aria-hidden="true" />
                </div>
                <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900 dark:text-slate-300 dark:group-hover:text-white transition-colors flex-1">
                  Review vendors
                </span>
                <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 dark:text-slate-700 dark:group-hover:text-slate-400 transition-colors" aria-hidden="true" />
              </Link>
              <Link
                href="/admin/loyalty"
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group"
              >
                <div className="h-8 w-8 rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 flex items-center justify-center shrink-0">
                  <Gift className="h-4 w-4" aria-hidden="true" />
                </div>
                <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900 dark:text-slate-300 dark:group-hover:text-white transition-colors flex-1">
                  Loyalty points
                </span>
                <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 dark:text-slate-700 dark:group-hover:text-slate-400 transition-colors" aria-hidden="true" />
              </Link>
              <Link
                href="/admin/payouts"
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group"
              >
                <div className="h-8 w-8 rounded-lg bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-slate-400 flex items-center justify-center shrink-0">
                  <Download className="h-4 w-4" aria-hidden="true" />
                </div>
                <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900 dark:text-slate-300 dark:group-hover:text-white transition-colors flex-1">
                  Export payouts CSV
                </span>
                <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 dark:text-slate-700 dark:group-hover:text-slate-400 transition-colors" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
