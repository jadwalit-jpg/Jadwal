'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { useToast } from '@/components/toast';
import AdminLayout from '../_components/admin-layout';
import { Search, ChevronLeft, ChevronRight, CheckCircle, Clock, XCircle, Globe, BadgeCheck, ChevronDown, Mail, Phone, Hash, Link as LinkIcon, Calendar, Building2, ShieldX, Trash2, AlertTriangle, Download, Percent } from 'lucide-react';
import CustomSelect from '@/components/custom-select';

interface Vendor {
  id: string;
  businessNameEn: string;
  businessNameAr: string;
  businessId: string;
  slug: string;
  phone: string | null;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  trustLevel: 'STANDARD' | 'VERIFIED';
  commissionPct: string | null;
  createdAt: string;
  user: { fullName: string; email: string };
  country: { nameEn: string; isoCode: string };
  _count: { activities: number; bookings: number };
}

interface VendorsResponse {
  data: Vendor[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const statusConfig: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  ACTIVE: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', icon: CheckCircle },
  PENDING: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', icon: Clock },
  SUSPENDED: { bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400', icon: XCircle },
};

function TableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-16 bg-gray-100 dark:bg-slate-800/60 rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

export default function AdminVendorsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleSearch = useCallback((val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedSearch(val); setPage(1); }, 300);
  }, []);

  const toggleSelect = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const { data: vendorStats } = useQuery({
    queryKey: ['admin', 'vendor-stats'],
    queryFn: async () => {
      const { data } = await api.get('/admin/vendors/stats');
      return data;
    },
  });

  const { data, isLoading, error } = useQuery<VendorsResponse>({
    queryKey: ['admin', 'vendors', page, debouncedSearch, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter) params.set('status', statusFilter);
      const { data } = await api.get(`/admin/vendors?${params}`);
      return data;
    },
    retry: 2,
  });

  const statusMutation = useMutation({
    mutationFn: async ({ vendorId, status }: { vendorId: string; status: string }) => {
      await api.patch(`/admin/vendors/${vendorId}/status`, { status });
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'vendors'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'vendor-stats'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-stats'] });
      toast(`Vendor status changed to ${variables.status}`);
    },
    onError: (error) => {
      toast(getApiError(error, 'Failed to update vendor status'), 'error');
    },
  });

  const trustMutation = useMutation({
    mutationFn: async ({ vendorId, trustLevel }: { vendorId: string; trustLevel: string }) => {
      await api.patch(`/admin/vendors/${vendorId}/trust`, { trustLevel });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'vendors'] });
      toast(`Vendor trust level set to ${variables.trustLevel}`);
    },
    onError: () => { toast('Failed to update trust level', 'error'); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (vendorId: string) => {
      await api.delete(`/admin/vendors/${vendorId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'vendors'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'vendor-stats'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-stats'] });
      setDeleteConfirm(null);
      setExpandedIds(new Set());
      toast('Vendor deleted successfully');
    },
    onError: () => { toast('Failed to delete vendor', 'error'); },
  });

  const commissionMutation = useMutation({
    mutationFn: async ({ vendorId, commissionPct }: { vendorId: string; commissionPct: number | null }) => {
      await api.patch(`/admin/vendors/${vendorId}/commission`, { commissionPct });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'vendors'] });
      toast('Commission updated');
    },
    onError: () => { toast('Failed to update commission', 'error'); },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ vendorIds, status }: { vendorIds: string[]; status: string }) => {
      await api.post('/admin/bulk/vendors/status', { vendorIds, status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'vendors'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'vendor-stats'] });
      setSelected(new Set());
      toast('Bulk status update completed');
    },
    onError: () => { toast('Failed to update vendors', 'error'); },
  });

  const handleExport = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/export/vendors');
      const rows = data.map((v: any) => ({
        Business: v.businessNameEn, Owner: v.user?.fullName ?? '', Email: v.user?.email ?? '',
        Country: v.country?.nameEn ?? '', Status: v.status, Trust: v.trustLevel,
        Activities: v._count?.activities ?? 0, Bookings: v._count?.bookings ?? 0,
        Created: new Date(v.createdAt).toISOString().slice(0, 10),
      }));
      const headers = Object.keys(rows[0]);
      const csv = [headers.join(','), ...rows.map((r: any) => headers.map((h) => `"${String(r[h]).replace(/"/g, '""')}"`).join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vendors-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Vendors exported');
    } catch { toast('Failed to export vendors', 'error'); }
  }, [toast]);

  return (
    <AdminLayout title="Vendor Management" subtitle="Manage vendor registrations, approvals, and activity listings.">
      {/* Stats Cards */}
      {vendorStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Vendors', value: vendorStats.total, icon: Building2, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10' },
            { label: 'Approved', value: vendorStats.active, icon: CheckCircle, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
            { label: 'Pending', value: vendorStats.pending, icon: Clock, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' },
            { label: 'Suspended', value: vendorStats.suspended, icon: ShieldX, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10' },
          ].map((stat) => (
            <div key={stat.label} className="p-5 rounded-2xl border border-gray-200/80 dark:border-slate-800/60 bg-white dark:bg-slate-900/50">
              <div className="flex items-center justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl ${stat.bg} flex items-center justify-center`}>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{stat.value}</p>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex flex-1 items-center gap-3 w-full">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-slate-500" />
            <input
              type="text"
              placeholder="Search by business name or email..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full ps-10 pe-4 py-2.5 bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
          </div>
          <CustomSelect
            options={[
              { value: 'PENDING', label: 'Pending' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'SUSPENDED', label: 'Suspended' },
            ]}
            value={statusFilter}
            onChange={(val) => { setStatusFilter(val); setPage(1); }}
            placeholder="All Statuses"
          />
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <CustomSelect
              options={[
                { value: 'ACTIVE', label: 'Approve All' },
                { value: 'SUSPENDED', label: 'Suspend All' },
              ]}
              value=""
              onChange={(val) => {
                if (val) bulkStatusMutation.mutate({ vendorIds: Array.from(selected), status: val });
              }}
              placeholder={`Bulk: ${selected.size} selected`}
            />
          )}
          <button type="button" onClick={handleExport} className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-300 text-sm font-medium rounded-xl transition-all">
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-400">
          Failed to load vendors. Please refresh the page.
        </div>
      )}
      {isLoading ? (
        <TableSkeleton />
      ) : (
        <div className="rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-800">
                  <th className="px-6 py-4 w-10">
                    <input
                      type="checkbox"
                      checked={data?.data.length ? data.data.every((v) => selected.has(v.id)) : false}
                      onChange={() => {
                        if (!data?.data.length) return;
                        if (data.data.every((v) => selected.has(v.id))) setSelected(new Set());
                        else setSelected(new Set(data.data.map((v) => v.id)));
                      }}
                      className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Vendor</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Country</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Activities</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Bookings</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Trust</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="text-end px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                {data?.data.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-gray-400 dark:text-slate-500">No vendors found.</td>
                  </tr>
                )}
                {data?.data.map((vendor) => {
                  const badge = statusConfig[vendor.status] || statusConfig['PENDING'];
                  const BadgeIcon = badge.icon;
                  const isExpanded = expandedIds.has(vendor.id);
                  return (
                    <React.Fragment key={vendor.id}>
                      <tr
                        data-testid={`vendor-row-${vendor.id}`}
                        onClick={() => setExpandedIds((prev) => { const n = new Set(prev); if (n.has(vendor.id)) n.delete(vendor.id); else n.add(vendor.id); return n; })}
                        className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer"
                      >
                        <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected.has(vendor.id)}
                            onChange={() => toggleSelect(vendor.id)}
                            className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                              <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                                {vendor.businessNameEn.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <p className="font-medium text-gray-900 dark:text-white">{vendor.businessNameEn}</p>
                                <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                              </div>
                              <p className="text-xs text-gray-400 dark:text-slate-500">{vendor.user?.fullName || '—'} &middot; {vendor.user?.email || '—'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center gap-1.5 text-gray-600 dark:text-slate-300">
                            <Globe className="h-3.5 w-3.5 text-gray-400 dark:text-slate-500" />
                            {vendor.country?.nameEn || '—'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-600 dark:text-slate-300 font-medium">{vendor._count.activities}</td>
                        <td className="px-6 py-4 text-gray-600 dark:text-slate-300 font-medium">{vendor._count.bookings}</td>
                        <td className="px-6 py-4">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); trustMutation.mutate({ vendorId: vendor.id, trustLevel: vendor.trustLevel === 'VERIFIED' ? 'STANDARD' : 'VERIFIED' }); }}
                            disabled={trustMutation.isPending}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium transition-all ${vendor.trustLevel === 'VERIFIED' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'bg-gray-500/10 text-gray-500 dark:text-slate-400 hover:bg-blue-500/10 hover:text-blue-600'}`}
                            title={vendor.trustLevel === 'VERIFIED' ? 'Remove verified badge' : 'Mark as verified'}
                          >
                            <BadgeCheck className="h-3.5 w-3.5" />
                            {vendor.trustLevel}
                          </button>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${badge.bg} ${badge.text}`}>
                            <BadgeIcon className="h-3.5 w-3.5" />
                            {vendor.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-end" onClick={(e) => e.stopPropagation()}>
                          <CustomSelect
                            options={[
                              { value: 'PENDING', label: 'Pending' },
                              { value: 'ACTIVE', label: 'Active' },
                              { value: 'SUSPENDED', label: 'Suspended' },
                            ]}
                            value={vendor.status}
                            onChange={(val) => statusMutation.mutate({ vendorId: vendor.id, status: val })}
                            disabled={statusMutation.isPending}
                          />
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={8} className="px-6 py-0">
                            <div className="py-5 border-t border-gray-100 dark:border-slate-800/40">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Vendor Information */}
                                <div>
                                  <h4 className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-3">Vendor Information</h4>
                                  <div className="space-y-2.5">
                                    <div className="flex items-center gap-2 text-sm">
                                      <Building2 className="h-4 w-4 text-gray-400 dark:text-slate-500 shrink-0" />
                                      <span className="text-gray-500 dark:text-slate-400">Business:</span>
                                      <span className="text-gray-900 dark:text-white font-medium wrap-break-word min-w-0">{vendor.businessNameEn}</span>
                                      <span className="text-gray-400 dark:text-slate-500 wrap-break-word min-w-0">({vendor.businessNameAr})</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm">
                                      <Hash className="h-4 w-4 text-gray-400 dark:text-slate-500 shrink-0" />
                                      <span className="text-gray-500 dark:text-slate-400">Business ID:</span>
                                      <span className="text-gray-900 dark:text-white font-medium">{vendor.businessId}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm">
                                      <LinkIcon className="h-4 w-4 text-gray-400 dark:text-slate-500 shrink-0" />
                                      <span className="text-gray-500 dark:text-slate-400">Slug:</span>
                                      <span className="text-gray-900 dark:text-white font-medium">{vendor.slug}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm">
                                      <Mail className="h-4 w-4 text-gray-400 dark:text-slate-500 shrink-0" />
                                      <span className="text-gray-500 dark:text-slate-400">Email:</span>
                                      <span className="text-gray-900 dark:text-white font-medium wrap-break-word min-w-0">{vendor.user.email}</span>
                                    </div>
                                    {vendor.phone && (
                                      <div className="flex items-center gap-2 text-sm">
                                        <Phone className="h-4 w-4 text-gray-400 dark:text-slate-500 shrink-0" />
                                        <span className="text-gray-500 dark:text-slate-400">Phone:</span>
                                        <span className="text-gray-900 dark:text-white font-medium">{vendor.phone}</span>
                                      </div>
                                    )}
                                    <div className="flex items-center gap-2 text-sm">
                                      <Globe className="h-4 w-4 text-gray-400 dark:text-slate-500 shrink-0" />
                                      <span className="text-gray-500 dark:text-slate-400">Country:</span>
                                      <span className="text-gray-900 dark:text-white font-medium">{vendor.country.nameEn} ({vendor.country.isoCode})</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm">
                                      <Calendar className="h-4 w-4 text-gray-400 dark:text-slate-500 shrink-0" />
                                      <span className="text-gray-500 dark:text-slate-400">Registered:</span>
                                      <span className="text-gray-900 dark:text-white font-medium">{new Date(vendor.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm">
                                      <Percent className="h-4 w-4 text-gray-400 dark:text-slate-500 shrink-0" />
                                      <span className="text-gray-500 dark:text-slate-400">Commission:</span>
                                      <form
                                        className="flex items-center gap-1.5"
                                        onSubmit={(e) => {
                                          e.preventDefault();
                                          const val = (e.currentTarget.elements.namedItem('pct') as HTMLInputElement).value;
                                          commissionMutation.mutate({ vendorId: vendor.id, commissionPct: val ? Number(val) : null });
                                        }}
                                      >
                                        <input
                                          name="pct"
                                          type="number"
                                          min="0"
                                          max="100"
                                          step="0.01"
                                          defaultValue={vendor.commissionPct ?? ''}
                                          placeholder="Default"
                                          className="w-20 px-2 py-1 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm text-gray-900 dark:text-white outline-none focus:border-blue-500 text-center"
                                        />
                                        <span className="text-gray-400 text-xs">%</span>
                                        <button type="submit" disabled={commissionMutation.isPending} className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50 cursor-pointer">
                                          {commissionMutation.isPending ? '...' : 'Set'}
                                        </button>
                                      </form>
                                      {!vendor.commissionPct && <span className="text-xs text-gray-400 dark:text-slate-500">(uses platform default)</span>}
                                    </div>
                                  </div>
                                </div>

                                {/* Quick Stats & Actions */}
                                <div>
                                  <h4 className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-3">Quick Stats</h4>
                                  <div className="grid grid-cols-2 gap-3 mb-4">
                                    <div className="p-3 rounded-xl bg-gray-50 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-800/60">
                                      <p className="text-2xl font-bold text-gray-900 dark:text-white">{vendor._count.activities}</p>
                                      <p className="text-xs text-gray-500 dark:text-slate-400">Activities</p>
                                    </div>
                                    <div className="p-3 rounded-xl bg-gray-50 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-800/60">
                                      <p className="text-2xl font-bold text-gray-900 dark:text-white">{vendor._count.bookings}</p>
                                      <p className="text-xs text-gray-500 dark:text-slate-400">Bookings</p>
                                    </div>
                                  </div>

                                  <h4 className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-3">Actions</h4>
                                  <div className="flex flex-wrap gap-2">
                                    {vendor.status !== 'SUSPENDED' ? (
                                      <button
                                        type="button"
                                        data-testid={`vendor-suspend-${vendor.id}`}
                                        onClick={(e) => { e.stopPropagation(); statusMutation.mutate({ vendorId: vendor.id, status: 'SUSPENDED' }); }}
                                        disabled={statusMutation.isPending}
                                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors cursor-pointer"
                                      >
                                        <ShieldX className="h-3.5 w-3.5" />
                                        Suspend Vendor
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        data-testid={`vendor-activate-${vendor.id}`}
                                        onClick={(e) => { e.stopPropagation(); statusMutation.mutate({ vendorId: vendor.id, status: 'ACTIVE' }); }}
                                        disabled={statusMutation.isPending}
                                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors cursor-pointer"
                                      >
                                        <CheckCircle className="h-3.5 w-3.5" />
                                        Activate Vendor
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      data-testid={`vendor-delete-${vendor.id}`}
                                      onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ id: vendor.id, name: vendor.businessNameEn }); }}
                                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800/50 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors cursor-pointer"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      Delete Vendor
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
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
      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Delete Vendor</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">
              Are you sure you want to delete <span className="font-semibold text-gray-900 dark:text-white">{deleteConfirm.name}</span>?
            </p>
            <p className="text-xs text-red-600 dark:text-red-400 mb-6">
              This will permanently delete the vendor, their user account, all activities, bookings, reviews, payments, and coupons. This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="vendor-delete-confirm"
                onClick={() => deleteMutation.mutate(deleteConfirm.id)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
