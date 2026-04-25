'use client';

import { useState, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import AdminLayout from '../_components/admin-layout';
import { Search, ChevronLeft, ChevronRight, Shield, Store, UserCheck, Cpu, List, Clock } from 'lucide-react';
import DateRangePicker from '@/components/date-range-picker';

interface AuditLog {
  id: string;
  actorType: 'ADMIN' | 'VENDOR' | 'CUSTOMER' | 'SYSTEM';
  actorId: string;
  actorName: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: string | null;
  createdAt: string;
}

interface AuditLogsResponse {
  data: AuditLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const ACTOR_TABS = [
  { key: '', label: 'All', icon: null },
  { key: 'ADMIN', label: 'Admin', icon: Shield },
  { key: 'VENDOR', label: 'Vendor', icon: Store },
  { key: 'CUSTOMER', label: 'Customer', icon: UserCheck },
  { key: 'SYSTEM', label: 'System', icon: Cpu },
] as const;

const actorBadgeStyles: Record<string, string> = {
  ADMIN: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  VENDOR: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  CUSTOMER: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  SYSTEM: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
};

const actorAvatarStyles: Record<string, string> = {
  ADMIN: 'from-blue-500 to-indigo-600',
  VENDOR: 'from-violet-500 to-purple-600',
  CUSTOMER: 'from-emerald-500 to-teal-600',
  SYSTEM: 'from-gray-500 to-slate-600',
};

const actionColors: Record<string, string> = {
  CREATE: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  UPDATE: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  DELETE: 'bg-red-500/10 text-red-600 dark:text-red-400',
  APPROVE: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  CANCEL: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  TOGGLE: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  BOOKING: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  AUTO: 'bg-gray-500/10 text-gray-500 dark:text-gray-400',
  CHANGE: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  BLOCK: 'bg-red-500/10 text-red-600 dark:text-red-400',
  MARK: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  BULK: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  UPLOAD: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  REPLY: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
};

function getActionColor(action: string) {
  const upper = action.toUpperCase();
  const key = Object.keys(actionColors).find((k) => upper.includes(k));
  return key ? actionColors[key] : 'bg-gray-500/10 text-gray-600 dark:text-gray-400';
}

function TableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-14 bg-gray-100 dark:bg-slate-800/60 rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

function TimelineView({ logs }: { logs: AuditLog[] }) {
  // Group logs by date
  const grouped: Record<string, AuditLog[]> = {};
  for (const log of logs) {
    const day = new Date(log.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(log);
  }

  if (logs.length === 0) {
    return <div className="py-12 text-center text-sm text-gray-400 dark:text-slate-500">No audit logs found.</div>;
  }

  return (
    <div className="space-y-8">
      {Object.entries(grouped).map(([day, dayLogs]) => (
        <div key={day}>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px flex-1 bg-gray-200 dark:bg-slate-800" />
            <span className="text-xs font-semibold text-gray-500 dark:text-slate-400 bg-gray-50 dark:bg-slate-950 px-3">{day}</span>
            <div className="h-px flex-1 bg-gray-200 dark:bg-slate-800" />
          </div>
          <div className="relative ps-8">
            {/* Timeline line */}
            <div className="absolute inset-s-3 top-0 bottom-0 w-px bg-gray-200 dark:bg-slate-800" />

            <div className="space-y-4">
              {dayLogs.map((log) => (
                <div key={log.id} className="relative">
                  {/* Dot */}
                  <div className={`absolute -inset-s-5 top-1 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-950 ${
                    log.actorType === 'ADMIN' ? 'bg-blue-500' :
                    log.actorType === 'VENDOR' ? 'bg-violet-500' :
                    log.actorType === 'CUSTOMER' ? 'bg-emerald-500' : 'bg-gray-400'
                  }`} />

                  <div className="rounded-xl bg-white dark:bg-slate-900/60 border border-gray-100 dark:border-slate-800/60 p-4 hover:border-gray-200 dark:hover:border-slate-700 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`h-7 w-7 rounded-full bg-linear-to-br ${actorAvatarStyles[log.actorType] || 'from-gray-500 to-slate-600'} flex items-center justify-center text-white text-[10px] font-bold shrink-0`}>
                          {log.actorName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{log.actorName}</span>
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${actorBadgeStyles[log.actorType] || ''}`}>
                              {log.actorType}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${getActionColor(log.action)}`}>
                              {log.action}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-slate-400">
                              on <span className="font-medium">{log.entity}</span>
                              {log.entityId && <span className="font-mono text-[10px] text-gray-400 dark:text-slate-500 ms-1">{log.entityId.slice(0, 8)}</span>}
                            </span>
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] text-gray-400 dark:text-slate-500 whitespace-nowrap shrink-0">
                        {new Date(log.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {log.details && (
                      <p className="mt-2 text-xs text-gray-400 dark:text-slate-500 truncate ps-9" title={log.details}>
                        {(() => {
                          try {
                            const parsed = JSON.parse(log.details);
                            return Object.entries(parsed).slice(0, 3).map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`).join(' · ');
                          } catch {
                            return String(log.details).slice(0, 100);
                          }
                        })()}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminAuditLogsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [actorType, setActorType] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'timeline'>('timeline');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleSearch = useCallback((val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1);
    }, 300);
  }, []);

  const handleTabChange = useCallback((tab: string) => {
    setActorType(tab);
    setPage(1);
  }, []);

  const { data, isLoading } = useQuery<AuditLogsResponse>({
    queryKey: ['admin', 'audit-logs', page, debouncedSearch, actorType, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (actorType) params.set('actorType', actorType);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      const { data } = await api.get(`/admin/audit-logs?${params}`);
      return data;
    },
  });

  return (
    <AdminLayout title="Audit Logs" subtitle="Track all actions across the platform">
      {/* Filter tabs */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {ACTOR_TABS.map((tab) => {
          const isActive = actorType === tab.key;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleTabChange(tab.key)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all ${
                isActive
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-slate-800/60 text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700/60'
              }`}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Search + Date range */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
        <div className="relative flex-1 w-full sm:max-w-sm">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-slate-500" />
          <input
            type="text"
            placeholder="Search by action, entity, actor..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full ps-10 pe-4 py-2.5 bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
          />
        </div>

        <DateRangePicker
          from={dateFrom}
          to={dateTo}
          onChange={(f, t) => { setDateFrom(f); setDateTo(t); setPage(1); }}
        />

        {/* View toggle */}
        <div className="flex items-center bg-gray-100 dark:bg-slate-800/60 rounded-xl p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('timeline')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${viewMode === 'timeline' ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-slate-400'}`}
          >
            <Clock className="h-3.5 w-3.5" />
            Timeline
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${viewMode === 'table' ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-slate-400'}`}
          >
            <List className="h-3.5 w-3.5" />
            Table
          </button>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : viewMode === 'timeline' ? (
        <>
          <TimelineView logs={data?.data ?? []} />
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between mt-6">
              <p className="text-xs text-gray-500 dark:text-slate-400">
                Showing {((data.page - 1) * data.limit) + 1}–{Math.min(data.page * data.limit, data.total)} of {data.total}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-all">
                  <ChevronLeft className="h-4 w-4 text-gray-600 dark:text-slate-400" />
                </button>
                <span className="text-xs text-gray-600 dark:text-slate-400 font-medium">{data.page} / {data.totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))} disabled={page >= data.totalPages} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-all">
                  <ChevronRight className="h-4 w-4 text-gray-600 dark:text-slate-400" />
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-800">
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Timestamp</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Actor</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Type</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Action</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Entity</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                {data?.data.length === 0 && (
                  <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-400 dark:text-slate-500">No audit logs found.</td></tr>
                )}
                {data?.data.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-3.5 text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className={`h-7 w-7 rounded-full bg-linear-to-br ${actorAvatarStyles[log.actorType] || 'from-gray-500 to-slate-600'} flex items-center justify-center text-white text-[10px] font-bold shrink-0`}>
                          {log.actorName.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium text-gray-700 dark:text-slate-300 truncate max-w-[140px]">{log.actorName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase ${actorBadgeStyles[log.actorType] || ''}`}>
                        {log.actorType}
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${getActionColor(log.action)}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      <span className="text-sm text-gray-600 dark:text-slate-300">{log.entity}</span>
                      {log.entityId && (
                        <span className="ms-1.5 font-mono text-[10px] text-gray-400 dark:text-slate-500">{log.entityId.slice(0, 8)}...</span>
                      )}
                    </td>
                    <td className="px-6 py-3.5 text-sm text-gray-500 dark:text-slate-400 max-w-xs">
                      {log.details ? (
                        <span className="block truncate" title={log.details}>
                          {(() => {
                            try {
                              const parsed = JSON.parse(log.details);
                              return Object.entries(parsed).slice(0, 3).map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`).join(' · ');
                            } catch {
                              return String(log.details).slice(0, 80);
                            }
                          })()}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-slate-800">
              <p className="text-xs text-gray-500 dark:text-slate-400">
                Showing {((data.page - 1) * data.limit) + 1}–{Math.min(data.page * data.limit, data.total)} of {data.total}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-all">
                  <ChevronLeft className="h-4 w-4 text-gray-600 dark:text-slate-400" />
                </button>
                <span className="text-xs text-gray-600 dark:text-slate-400 font-medium">{data.page} / {data.totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))} disabled={page >= data.totalPages} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-all">
                  <ChevronRight className="h-4 w-4 text-gray-600 dark:text-slate-400" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </AdminLayout>
  );
}
