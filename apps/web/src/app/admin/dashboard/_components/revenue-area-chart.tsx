'use client';

import { TrendingUp } from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

export interface MonthlyRevenue {
  month: string;
  revenue: number;
}

function RevenueTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const revenue = Number(payload[0]?.value ?? 0);
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl px-3.5 py-2.5 min-w-[140px]">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-1.5">{label}</p>
      <div className="flex items-center justify-between gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5 text-gray-600 dark:text-slate-300">
          <span className="w-2 h-2 rounded-sm bg-sky-500" />
          Cash revenue
        </span>
        <span className="font-semibold tabular-nums text-gray-900 dark:text-white">QAR {revenue.toLocaleString()}</span>
      </div>
    </div>
  );
}

export default function RevenueAreaChart({ data }: { data: MonthlyRevenue[] }) {
  if (data.length === 0) {
    return (
      <div className="h-40 flex flex-col items-center justify-center gap-2 text-center">
        <TrendingUp className="h-6 w-6 text-gray-300 dark:text-slate-600" aria-hidden="true" />
        <p className="text-xs text-gray-500 dark:text-slate-400">No revenue data yet</p>
      </div>
    );
  }
  return (
    <div className="w-full h-40">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="adminAreaCash" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="currentColor"
            className="text-gray-200 dark:text-slate-800"
            vertical={false}
          />
          <XAxis
            dataKey="month"
            stroke="currentColor"
            className="text-gray-400 dark:text-slate-500"
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            stroke="currentColor"
            className="text-gray-400 dark:text-slate-500"
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip content={<RevenueTooltip />} />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="#0ea5e9"
            strokeWidth={2}
            fill="url(#adminAreaCash)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
