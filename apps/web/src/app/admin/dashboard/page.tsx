'use client';

/**
 * Admin Dashboard — Jadwal platform overview.
 *
 * Data sources (server-paced, all cached via TanStack):
 *   GET /admin/dashboard/stats   — top-level KPIs + financial liability
 *   GET /admin/dashboard/charts  — 6-month revenue series, vendor growth, top activities
 *
 * Layout (matches the design-system brief, adapted to our existing
 * sidebar/topbar which stay untouched):
 *   1. Greeting row — user name, date, sync freshness (computed from
 *      TanStack `dataUpdatedAt`).
 *   2. Platform overview — 4 small KPIs + 3 large KPIs (cash / bookings value / Wanasa).
 *   3. Financial health — 3 KPIs + hero loyalty-liability card (donut) + 2 side KPIs.
 *   4. Trends — 3 cards: revenue sparkline, vendor-growth bars, top-activities table.
 *   5. Queues + Recent activity — pending verifications, moderation queue, platform feed.
 *   6. Quick actions — 4 links to the most-used admin pages.
 *
 * Things intentionally OUT of scope (no backend support yet):
 *   - Range tabs (7d/30d/MTD/…) — /admin/dashboard/stats has no period param.
 *   - Period-over-period trend deltas — no prior-period calc on server.
 *   - Platform-wide audit feed — no roll-up endpoint yet.
 */

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/auth-context';
import api from '@/lib/api';
import AdminLayout from '../_components/admin-layout';
import {
  Users,
  Store,
  CalendarRange,
  BookOpen,
  DollarSign,
  Clock,
  AlertCircle,
  Receipt,
  Sparkles,
  Percent,
  Banknote,
  Wallet,
  Coins,
  Shield,
  ChevronRight,
  TrendingUp,
  CircleCheck,
  Gift,
  Download,
  Info,
} from 'lucide-react';
import type { MonthlyRevenue } from './_components/revenue-area-chart';

// Recharts is ~250 kB minified. Keep it out of the dashboard's first-load
// JS by code-splitting; the chart paints client-side after the data is in.
const RevenueAreaChart = dynamic(
  () => import('./_components/revenue-area-chart'),
  {
    ssr: false,
    loading: () => (
      <div
        className="w-full h-40 rounded-lg bg-gray-100/60 dark:bg-slate-800/40 animate-pulse"
        aria-hidden="true"
      />
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

// Tone presets extracted from the design brief's palette. Each `fg` pair
// covers the accent text colour in light and dark mode; `bg` is the soft
// tinted pill behind the icon. Centralised so every KPI card on the page
// references the same source of truth.
type Tone = 'sky' | 'emerald' | 'amber' | 'gold' | 'indigo' | 'slate' | 'red';

const TONE_CLASSES: Record<Tone, { bg: string; fg: string }> = {
  sky: { bg: 'bg-sky-500/10 dark:bg-sky-500/15', fg: 'text-sky-600 dark:text-sky-400' },
  emerald: { bg: 'bg-emerald-500/10 dark:bg-emerald-500/15', fg: 'text-emerald-600 dark:text-emerald-400' },
  amber: { bg: 'bg-amber-500/10 dark:bg-amber-500/15', fg: 'text-amber-600 dark:text-amber-400' },
  gold: { bg: 'bg-yellow-500/10 dark:bg-yellow-500/15', fg: 'text-yellow-700 dark:text-yellow-400' },
  indigo: { bg: 'bg-indigo-500/10 dark:bg-indigo-500/15', fg: 'text-indigo-600 dark:text-indigo-400' },
  slate: { bg: 'bg-slate-500/10 dark:bg-slate-500/15', fg: 'text-slate-600 dark:text-slate-400' },
  red: { bg: 'bg-red-500/10 dark:bg-red-500/15', fg: 'text-red-600 dark:text-red-400' },
};

// ─── KPI Card ──────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  tone,
  size = 'md',
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  tone: Tone;
  size?: 'md' | 'lg';
}) {
  const t = TONE_CLASSES[tone];
  const valueClass = size === 'lg' ? 'text-3xl sm:text-4xl' : 'text-2xl';
  return (
    <div className="rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 p-5 sm:p-6 flex flex-col gap-3 hover:shadow-md hover:shadow-gray-200/40 dark:hover:shadow-slate-900/40 transition-shadow duration-200 min-h-[126px]">
      <div className="flex items-start justify-between">
        <div className={`h-10 w-10 rounded-xl ${t.bg} ${t.fg} flex items-center justify-center`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-gray-500 dark:text-slate-400 tracking-wide">{label}</p>
        <p className={`mt-1 font-bold tracking-tight text-gray-900 dark:text-white tabular-nums leading-tight ${valueClass}`}>{value}</p>
        {sub && <p className="mt-1.5 text-xs text-gray-500 dark:text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 p-5 sm:p-6 min-h-[126px]">
      <div className="h-10 w-10 rounded-xl bg-gray-100 dark:bg-slate-800 animate-pulse" />
      <div className="mt-4 h-3 w-20 bg-gray-100 dark:bg-slate-800 rounded animate-pulse" />
      <div className="mt-2 h-7 w-24 bg-gray-100 dark:bg-slate-800 rounded animate-pulse" />
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────

function SectionHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4 mt-2 flex-wrap">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">{title}</h2>
        {sub && <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

// ─── Bar chart (tiny) ────────────────────────────────────────

function BarChart({ data }: { data: { key: string; value: number }[] }) {
  const max = useMemo(() => Math.max(...data.map((d) => d.value), 1), [data]);
  if (data.length === 0) {
    return <div className="h-24 flex items-center justify-center text-xs text-gray-400 dark:text-slate-500">No data yet</div>;
  }
  return (
    <div className="flex items-end gap-2 h-24">
      {data.map((d) => (
        <div key={d.key} className="flex-1 flex flex-col items-center gap-1 min-w-0">
          <span className="text-[10px] font-semibold text-gray-700 dark:text-slate-300 tabular-nums">
            {d.value > 0 ? d.value : ''}
          </span>
          <div
            className={`w-full rounded-md transition-all duration-500 ${d.value > 0 ? 'bg-indigo-500/80 dark:bg-indigo-400/80' : 'bg-gray-100 dark:bg-slate-800'}`}
            style={{ height: `${Math.max((d.value / max) * 100, 4)}%`, minHeight: 4 }}
          />
          <span className="text-[10px] text-gray-400 dark:text-slate-500">{d.key.slice(-2)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Donut (for loyalty liability hero) ──────────────────────

function Donut({ value, cap, label, sub }: { value: number; cap: number; label: string; sub?: string }) {
  const size = 96;
  const thickness = 12;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const pct = cap > 0 ? Math.min(1, value / cap) : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="stroke-yellow-500/15"
          fill="none"
          strokeWidth={thickness}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="stroke-yellow-500 dark:stroke-yellow-400"
          fill="none"
          strokeWidth={thickness}
          strokeDasharray={`${(c * pct).toFixed(2)} ${c.toFixed(2)}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">{label}</span>
        {sub && <span className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">{sub}</span>}
      </div>
    </div>
  );
}

// ─── Chart card wrapper ──────────────────────────────────────

function ChartCard({
  title,
  sub,
  total,
  totalLabel,
  badge,
  children,
  className = '',
}: {
  title: string;
  sub?: string;
  total?: string;
  totalLabel?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 p-5 flex flex-col gap-4 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
          {sub && <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{sub}</p>}
        </div>
        {badge}
      </div>
      {total != null && totalLabel && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">{totalLabel}</p>
          <p className="text-2xl font-bold tracking-tight tabular-nums text-gray-900 dark:text-white">{total}</p>
        </div>
      )}
      <div className="mt-auto">{children}</div>
    </div>
  );
}

// ─── Queue empty card ────────────────────────────────────────

function QueueCard({
  title,
  sub,
  icon: Icon,
  count,
  emptyMsg,
}: {
  title: string;
  sub: string;
  icon: React.ElementType;
  count: number;
  emptyMsg: string;
}) {
  const empty = count === 0;
  return (
    <div className="rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 p-5 flex flex-col gap-4 min-h-[220px]">
      <div className="flex items-center gap-3">
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${empty ? 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{sub}</p>
        </div>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${empty ? 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
          {count}
        </span>
      </div>
      {empty ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
          <div className="h-11 w-11 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <CircleCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="text-xs text-gray-500 dark:text-slate-400 max-w-[240px]">{emptyMsg}</p>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-amber-700 dark:text-amber-400">{count} item{count === 1 ? '' : 's'} awaiting review</p>
        </div>
      )}
    </div>
  );
}

// ─── Top activities table ───────────────────────────────────

function TopActivitiesTable({ items }: { items: ChartsData['topActivities'] }) {
  if (!items.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <div className="h-10 w-10 rounded-xl bg-gray-100 dark:bg-slate-800 flex items-center justify-center text-gray-400">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium text-gray-700 dark:text-slate-300">No activities yet</p>
        <p className="text-xs text-gray-500 dark:text-slate-400 max-w-[220px]">Once vendors list activities and get bookings, leaders will show up here.</p>
      </div>
    );
  }
  const max = Math.max(...items.map((i) => i.bookings), 1);
  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_96px_72px] gap-3 px-1 pb-2 border-b border-gray-100 dark:border-slate-800 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
        <div>Activity</div>
        <div>Share</div>
        <div className="text-end">Revenue</div>
      </div>
      {items.slice(0, 5).map((a, i) => (
        <div
          key={i}
          className={`grid grid-cols-[minmax(0,1fr)_96px_72px] gap-3 px-1 py-3 items-center ${i < Math.min(items.length, 5) - 1 ? 'border-b border-gray-50 dark:border-slate-800/50' : ''}`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-1.5 h-9 rounded bg-sky-500 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{a.name}</p>
              <p className="text-[11px] text-gray-500 dark:text-slate-400 truncate">{a.category}</p>
            </div>
          </div>
          <div>
            <div className="h-1.5 rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-sky-500 rounded-full transition-all duration-500"
                style={{ width: `${(a.bookings / max) * 100}%` }}
              />
            </div>
            <p className="text-[10px] text-gray-500 dark:text-slate-400 mt-1 tabular-nums">
              {a.bookings} booking{a.bookings === 1 ? '' : 's'}
            </p>
          </div>
          <p className="text-sm font-bold text-gray-900 dark:text-white text-end tabular-nums">
            QAR {Number(a.revenue ?? 0).toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── Quick action card ──────────────────────────────────────

function QuickAction({
  icon: Icon,
  title,
  sub,
  tone,
  href,
}: {
  icon: React.ElementType;
  title: string;
  sub: string;
  tone: Tone;
  href: string;
}) {
  const t = TONE_CLASSES[tone];
  return (
    <a
      href={href}
      className="rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 p-4 flex items-center gap-3 hover:border-sky-400 dark:hover:border-sky-500/60 transition-colors group"
    >
      <div className={`h-10 w-10 rounded-xl ${t.bg} ${t.fg} flex items-center justify-center shrink-0`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{title}</p>
        <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{sub}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-sky-500 transition-colors" aria-hidden="true" />
    </a>
  );
}

// ─── Page ──────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const { user } = useAuth();

  const { data: stats, isLoading, dataUpdatedAt } = useQuery<DashboardStats>({
    queryKey: ['admin', 'dashboard-stats'],
    queryFn: async () => {
      const { data } = await api.get('/admin/dashboard/stats');
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

  // Derived chart series. Shaped as { month, revenue } so the Recharts
  // AreaChart can bind directly — same shape the vendor analytics page
  // uses, keeping both dashboards visually and structurally consistent.
  // Month label is rendered "Mon YY" (e.g. "Apr 26") so the axis reads
  // naturally even when 6 months span a year boundary.
  const revenueSeries: MonthlyRevenue[] = useMemo(() => {
    if (!charts?.revenueByMonth) return [];
    return Object.entries(charts.revenueByMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => {
        const [year, month] = key.split('-');
        const d = new Date(Number(year), Number(month) - 1, 1);
        return {
          month: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
          revenue: Number(value),
        };
      });
  }, [charts]);

  const vendorSeries = useMemo(() => {
    if (!charts?.vendorsByMonth) return [];
    return Object.entries(charts.vendorsByMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({ key, value: Number(value) }));
  }, [charts]);

  // "Last sync N min ago" — derived from TanStack's dataUpdatedAt so it
  // reflects the actual last network fetch, not a fake clock.
  const syncLabel = useMemo(() => {
    if (!dataUpdatedAt) return 'syncing…';
    const diffSec = Math.floor((Date.now() - dataUpdatedAt) / 1000);
    if (diffSec < 60) return 'just now';
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs} hr ago`;
  }, [dataUpdatedAt]);

  const todayLabel = useMemo(() => {
    return new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }, []);

  // Loyalty liability cap — env-tunable future policy. Display-only,
  // used to draw the donut proportion. 100_000 is a sensible display
  // ceiling for a fresh platform; teams can tune via the public env.
  const loyaltyCap = Number(process.env.NEXT_PUBLIC_LOYALTY_DISPLAY_CAP || 100000);
  const pointsIssued = Number(stats?.totalPointsIssued ?? 0);
  const pointsWorthQar = useMemo(() => {
    // Rough equivalence — real conversion is settings-driven; this is a
    // display hint only so admin can reason about cash exposure.
    const qarPerPoint = Number(process.env.NEXT_PUBLIC_LOYALTY_QAR_PER_POINT || 0.01);
    return Math.round(pointsIssued * qarPerPoint);
  }, [pointsIssued]);

  return (
    <AdminLayout title="Platform Dashboard">
      {/* ─── Greeting row ───────────────────────────────────── */}
      <div className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            Welcome back{user?.fullName ? `, ${user.fullName.split(' ')[0]}` : ''} · {todayLabel}
          </p>
          <div className="flex items-center gap-3 mt-2 text-sm flex-wrap">
            <span className="inline-flex items-center gap-2 text-gray-700 dark:text-slate-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              All systems operational
            </span>
            <span className="text-gray-300 dark:text-slate-600">·</span>
            <span className="text-gray-500 dark:text-slate-400">Last sync {syncLabel}</span>
          </div>
        </div>
      </div>

      {/* ─── Section 1: Platform overview ──────────────────── */}
      <section className="mb-10">
        <SectionHeader title="Platform overview" sub="Key metrics at a glance" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {isLoading ? (
            <>{Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)}</>
          ) : (
            <>
              <KpiCard tone="sky" icon={Users} label="Total users" value={stats?.totalUsers ?? 0} />
              <KpiCard
                tone="indigo"
                icon={Store}
                label="Active vendors"
                value={stats?.activeVendors ?? 0}
                sub={`${stats?.pendingVendors ?? 0} pending approval`}
              />
              <KpiCard
                tone="emerald"
                icon={CalendarRange}
                label="Total activities"
                value={stats?.totalActivities ?? 0}
                sub={`${stats?.pendingActivities ?? 0} pending review`}
              />
              <KpiCard
                tone="gold"
                icon={BookOpen}
                label="Total bookings"
                value={stats?.totalBookings ?? 0}
                sub={`${stats?.confirmedBookings ?? 0} confirmed`}
              />
            </>
          )}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {isLoading ? (
            <>{Array.from({ length: 3 }).map((_, i) => <KpiSkeleton key={`l-${i}`} />)}</>
          ) : (
            <>
              <KpiCard
                tone="emerald"
                icon={DollarSign}
                label="Cash revenue"
                value={`QAR ${Number(stats?.totalRevenue ?? 0).toLocaleString()}`}
                sub="Cash settled this period"
                size="lg"
              />
              <KpiCard
                tone="sky"
                icon={Receipt}
                label="Bookings value"
                value={`QAR ${Number(stats?.bookingsValue ?? 0).toLocaleString()}`}
                sub="Nominal value · cash + points + coupons"
                size="lg"
              />
              <KpiCard
                tone="gold"
                icon={Gift}
                label="Wanasa funded"
                value={`QAR ${Number(stats?.wanasaFundedValue ?? 0).toLocaleString()}`}
                sub="Paid via loyalty points"
                size="lg"
              />
            </>
          )}
        </div>
      </section>

      {/* ─── Section 2: Financial health ───────────────────── */}
      <section className="mb-10">
        <SectionHeader
          title="Financial health"
          sub="Platform revenue decomposition + liability exposure"
          action={
            <a
              href="/admin/payouts"
              className="inline-flex items-center gap-1 text-sm font-semibold text-sky-600 dark:text-sky-400 hover:underline"
            >
              Full ledger <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </a>
          }
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
          {isLoading ? (
            <>{Array.from({ length: 3 }).map((_, i) => <KpiSkeleton key={`fh-${i}`} />)}</>
          ) : (
            <>
              <KpiCard
                tone="emerald"
                icon={Percent}
                label="Platform commission"
                value={`QAR ${Number(stats?.totalCommission ?? 0).toLocaleString()}`}
                sub="Lifetime gross margin"
              />
              <KpiCard
                tone="sky"
                icon={Banknote}
                label="Service fees collected"
                value={`QAR ${Number(stats?.totalServiceFees ?? 0).toLocaleString()}`}
                sub="Cash-path only · waived for Wanasa"
              />
              <KpiCard
                tone="amber"
                icon={Wallet}
                label="Pending payout owed"
                value={`QAR ${Number(stats?.pendingPayoutOwed ?? 0).toLocaleString()}`}
                sub="What admin owes vendors"
              />
            </>
          )}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4">
          {/* Hero loyalty liability card — donut + label */}
          <div className="rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 p-6 flex items-center gap-5 relative overflow-hidden">
            {/* soft radial accent */}
            <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-yellow-500/8 pointer-events-none" aria-hidden="true" />
            <Donut
              value={pointsIssued}
              cap={loyaltyCap}
              label={pointsIssued >= 1000 ? `${(pointsIssued / 1000).toFixed(0)}k` : String(pointsIssued)}
              sub={`of ${loyaltyCap / 1000}k cap`}
            />
            <div className="flex-1 min-w-0 relative">
              <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-yellow-700 dark:text-yellow-400">
                <Coins className="h-3 w-3" aria-hidden="true" /> Loyalty points outstanding
              </p>
              <p className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white mt-1 tabular-nums">
                {pointsIssued.toLocaleString()}
                <span className="text-base font-medium text-gray-500 dark:text-slate-400 ms-2">pts</span>
              </p>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                Future-booking liability · worth ≈{' '}
                <span className="font-semibold text-gray-900 dark:text-white">QAR {pointsWorthQar.toLocaleString()}</span>
              </p>
            </div>
          </div>
          <KpiCard
            tone={(stats?.refundPendingCount ?? 0) > 0 ? 'red' : 'slate'}
            icon={Shield}
            label="Refunds pending"
            value={stats?.refundPendingCount ?? 0}
            sub={
              (stats?.refundPendingAmount ?? 0) > 0
                ? `QAR ${Number(stats?.refundPendingAmount ?? 0).toLocaleString()} awaiting decision`
                : 'No refund requests queued'
            }
          />
          <KpiCard
            tone={(stats?.pendingVendors ?? 0) > 0 ? 'amber' : 'slate'}
            icon={AlertCircle}
            label="Pending vendors"
            value={stats?.pendingVendors ?? 0}
            sub="Awaiting admin approval"
          />
        </div>
      </section>

      {/* ─── Section 3: Trends ─────────────────────────────── */}
      <section className="mb-10">
        <SectionHeader title="Trends" sub="Last 6 months" />
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.5fr)] gap-4">
          <ChartCard
            title="Revenue over time"
            sub="Cash settled · last 6 months"
            total={`QAR ${Number(stats?.totalRevenue ?? 0).toLocaleString()}`}
            totalLabel="Lifetime"
          >
            <RevenueAreaChart data={revenueSeries} />
          </ChartCard>
          <ChartCard
            title="New vendors by month"
            sub="Onboarded & verified"
            total={String(stats?.activeVendors ?? 0)}
            totalLabel="Active now"
          >
            <BarChart data={vendorSeries} />
          </ChartCard>
          <ChartCard title="Top booked activities" sub="By non-cancelled bookings">
            <TopActivitiesTable items={charts?.topActivities ?? []} />
          </ChartCard>
        </div>
      </section>

      {/* ─── Section 4: Queues ─────────────────────────────── */}
      <section className="mb-10">
        <SectionHeader title="Queues" sub="Work waiting on admin" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <QueueCard
            title="Pending vendor verifications"
            sub="New vendors awaiting KYC review"
            icon={Shield}
            count={stats?.pendingVendors ?? 0}
            emptyMsg="No pending verifications. You're all caught up."
          />
          <QueueCard
            title="Activity moderation queue"
            sub="Listings awaiting first-review"
            icon={Sparkles}
            count={stats?.pendingActivities ?? 0}
            emptyMsg="No activities awaiting moderation."
          />
        </div>
      </section>

      {/* ─── Section 5: Quick actions ──────────────────────── */}
      {/* Parked: the "Refund requests" quick action was removed because no
          dedicated page exists for it — refund decisions are recorded inline
          on /admin/bookings and the shortcut-to-inline-modal pattern was
          confusing. Restore if/when a standalone refund queue ships. */}
      <section className="mb-4">
        <SectionHeader title="Quick actions" sub="Jump to the most-used admin pages" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <QuickAction
            icon={Store}
            title="Review vendors"
            sub="Approve or reject pending vendor accounts"
            tone="sky"
            href="/admin/vendors"
          />
          <QuickAction
            icon={Gift}
            title="Loyalty points"
            sub="Grant or deduct Wanasa points"
            tone="gold"
            href="/admin/loyalty"
          />
          <QuickAction
            icon={Download}
            title="Payouts CSV"
            sub="Export payouts and financial reports"
            tone="slate"
            href="/admin/payouts"
          />
        </div>
      </section>

      {/* Help note: call out what's out-of-scope so admin doesn't hunt
          for features we haven't shipped yet. Quiet typography, easy
          to ignore once admin is trained. */}
      <div className="mt-8 rounded-xl border border-gray-100 dark:border-slate-800/60 bg-gray-50/60 dark:bg-slate-900/40 p-4 flex items-start gap-3">
        <Info className="h-4 w-4 text-gray-400 dark:text-slate-500 mt-0.5 shrink-0" aria-hidden="true" />
        <p className="text-xs text-gray-500 dark:text-slate-400 leading-relaxed">
          Figures reflect lifetime platform totals. Period-filtering, trend deltas, and a platform-wide activity feed will be
          added once the backend exposes time-window stats. <TrendingUp className="inline h-3 w-3" /> For finer-grained numbers, open the
          relevant page via Quick actions.
        </p>
      </div>
    </AdminLayout>
  );
}
