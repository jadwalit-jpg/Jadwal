'use client';

import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { sanitize } from '@/lib/validation';
import { getApiError } from '@/lib/api-error';
import { useToast } from '@/components/toast';
import AdminLayout from '../_components/admin-layout';
import { Search, ChevronLeft, ChevronRight, CheckCircle, Clock, XCircle, Plus, Trash2, Pencil, X, AlertTriangle, RefreshCw } from 'lucide-react';
import CustomSelect from '@/components/custom-select';

interface Coupon {
  id: string;
  code: string;
  discountType: 'PERCENTAGE' | 'FIXED';
  discountValue: string;
  validFrom: string;
  validTo: string;
  usageLimit: number | null;
  usedCount: number;
  minOrderAmount: string | null;
  maxDiscount: string | null;
  status: 'PENDING' | 'APPROVED' | 'EXPIRED';
  vendor: { businessNameEn: string } | null;
  createdAt: string;
}

interface CouponsResponse {
  data: Coupon[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const statusConfig: Record<string, { bg: string; text: string; icon: React.ElementType; label: string }> = {
  APPROVED: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', icon: CheckCircle, label: 'active' },
  PENDING: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', icon: Clock, label: 'pending' },
  EXPIRED: { bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400', icon: XCircle, label: 'expired' },
};

const inputCls =
  'w-full px-4 py-2.5 bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all';

const labelCls = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5';

function TableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-14 bg-gray-100 dark:bg-slate-800/60 rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

export default function AdminCouponsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [createModal, setCreateModal] = useState(false);
  const [modalDiscountType, setModalDiscountType] = useState('PERCENTAGE');
  const [couponCode, setCouponCode] = useState('');

  const generateCode = useCallback(() => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
    const prefix = 'JDWL-';
    // Use crypto.getRandomValues so the suggested code can't be predicted from
    // a known seed — coupons grant real discounts, so even though the admin
    // can edit the value, defaulting to a CSPRNG is the safer choice.
    const buf = new Uint32Array(8);
    crypto.getRandomValues(buf);
    let code = '';
    for (let i = 0; i < 8; i++) code += chars[buf[i] % chars.length];
    setCouponCode(prefix + code);
  }, []);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; code: string } | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 300);
  }, []);

  const { data, isLoading } = useQuery<CouponsResponse>({
    queryKey: ['admin', 'coupons', page, debouncedSearch, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter) params.set('status', statusFilter);
      const { data } = await api.get(`/admin/coupons?${params}`);
      return data;
    },
  });

  const filteredCoupons = data?.data.filter((c) => {
    if (sourceFilter === 'platform') return !c.vendor;
    if (sourceFilter === 'vendor') return !!c.vendor;
    return true;
  });

  const statusMutation = useMutation({
    mutationFn: async ({ couponId, status }: { couponId: string; status: string }) => {
      await api.patch(`/admin/coupons/${couponId}/status`, { status });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'coupons'] });
      toast(`Coupon status changed to ${variables.status}`);
    },
    onError: () => { toast('Failed to update coupon status', 'error'); },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      await api.post('/admin/coupons', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'coupons'] });
      setCreateModal(false);
      setModalDiscountType('PERCENTAGE');
      setCouponCode('');
      toast('Platform coupon created');
    },
    onError: (err) => {
      toast(getApiError(err, 'Failed to create coupon'), 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/admin/coupons/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'coupons'] });
      setDeleteConfirm(null);
      toast('Coupon deleted');
    },
    onError: () => { toast('Failed to delete coupon', 'error'); },
  });

  const handleCreateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const code = couponCode.trim().toUpperCase();
    if (!code || code.length < 3) { toast('Coupon code must be at least 3 characters', 'error'); return; }
    if (!/^[A-Z0-9_-]+$/.test(code)) { toast('Code can only contain letters, numbers, dashes, and underscores', 'error'); return; }
    const discountValue = Number(fd.get('discountValue'));
    const discountType = fd.get('discountType') as string;
    if (discountType === 'PERCENTAGE' && discountValue > 100) { toast('Percentage cannot exceed 100%', 'error'); return; }
    if (discountValue <= 0) { toast('Discount value must be greater than 0', 'error'); return; }
    const validFrom = fd.get('validFrom') as string;
    const validTo = fd.get('validTo') as string;
    if (new Date(validTo) <= new Date(validFrom)) { toast('Expiry date must be after start date', 'error'); return; }
    const payload: any = {
      code,
      discountType,
      discountValue,
      validFrom: new Date(validFrom).toISOString(),
      validTo: new Date(validTo).toISOString(),
    };
    const usageLimit = fd.get('usageLimit') as string;
    if (usageLimit && Number(usageLimit) > 0) payload.usageLimit = Number(usageLimit);
    const minOrder = fd.get('minOrderAmount') as string;
    if (minOrder && Number(minOrder) > 0) payload.minOrderAmount = Number(minOrder);
    const maxDiscount = fd.get('maxDiscount') as string;
    if (maxDiscount && Number(maxDiscount) > 0) payload.maxDiscount = Number(maxDiscount);
    createMutation.mutate(payload);
  };

  return (
    <AdminLayout title="Coupon & Offer Management" subtitle="Create platform coupons and manage vendor discount offers.">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
        <div className="relative flex-1 w-full sm:max-w-sm">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-slate-500" />
          <input
            type="text"
            placeholder="Search by code or vendor..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full ps-10 pe-4 py-2.5 bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
          />
        </div>
        <CustomSelect
          options={[
            { value: 'APPROVED', label: 'Active' },
            { value: 'PENDING', label: 'Pending' },
            { value: 'EXPIRED', label: 'Expired' },
          ]}
          value={statusFilter}
          onChange={(val) => { setStatusFilter(val); setPage(1); }}
          placeholder="All Status"
        />
        <CustomSelect
          options={[
            { value: 'platform', label: 'Platform' },
            { value: 'vendor', label: 'Vendor' },
          ]}
          value={sourceFilter}
          onChange={(val) => { setSourceFilter(val); setPage(1); }}
          placeholder="All Sources"
        />
        <div className="sm:ms-auto">
          <button
            type="button"
            onClick={() => setCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-all shadow-sm cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Create Platform Coupon
          </button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <TableSkeleton />
      ) : (
        <div className="rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-800">
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Code</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Vendor</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Type</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Value</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Usage</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Expiry</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="text-end px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                {(!filteredCoupons || filteredCoupons.length === 0) && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-gray-400 dark:text-slate-500">No coupons found.</td>
                  </tr>
                )}
                {filteredCoupons?.map((coupon) => {
                  const badge = statusConfig[coupon.status] ?? statusConfig.PENDING;
                  const BadgeIcon = badge.icon;
                  return (
                    <tr key={coupon.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <span className="font-mono font-bold text-gray-900 dark:text-white text-sm">{coupon.code}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${coupon.vendor ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400'}`}>
                          {coupon.vendor?.businessNameEn ?? 'Platform'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-600 dark:text-slate-300 text-xs">
                        {coupon.discountType === 'PERCENTAGE' ? 'Percentage' : 'Fixed'}
                      </td>
                      <td className="px-6 py-4 font-semibold text-gray-900 dark:text-white">
                        {coupon.discountType === 'PERCENTAGE' ? `${coupon.discountValue}%` : `${Number(coupon.discountValue).toLocaleString()} QAR`}
                      </td>
                      <td className="px-6 py-4 text-gray-600 dark:text-slate-300 text-xs">
                        {coupon.usedCount} / {coupon.usageLimit ?? '∞'}
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-500 dark:text-slate-400">
                        {new Date(coupon.validTo).toLocaleDateString('en-CA')}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${badge.bg} ${badge.text}`}>
                          <BadgeIcon className="h-3.5 w-3.5" />
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-end">
                        <div className="flex items-center justify-end gap-1">
                          <CustomSelect
                            options={[
                              { value: 'PENDING', label: 'Pending' },
                              { value: 'APPROVED', label: 'Active' },
                              { value: 'EXPIRED', label: 'Expired' },
                            ]}
                            value={coupon.status}
                            onChange={(val) => statusMutation.mutate({ couponId: coupon.id, status: val })}
                            disabled={statusMutation.isPending}
                          />
                          <button
                            type="button"
                            onClick={() => setDeleteConfirm({ id: coupon.id, code: coupon.code })}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 transition-all cursor-pointer"
                            title="Delete coupon"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
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

      {/* Create Coupon Modal */}
      {createModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Create Platform Coupon</h3>
              <button type="button" onClick={() => setCreateModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} className="p-6 space-y-4">
              <div>
                <label className={labelCls}>Coupon Code</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    required
                    placeholder="e.g. SUMMER2025"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
                    maxLength={30}
                    className={`${inputCls} uppercase font-mono flex-1`}
                  />
                  <button
                    type="button"
                    onClick={generateCode}
                    className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-300 text-xs font-medium rounded-xl border border-gray-200 dark:border-slate-700 transition-colors whitespace-nowrap cursor-pointer"
                    title="Generate random code"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Generate
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Discount Type</label>
                  <input type="hidden" name="discountType" value={modalDiscountType} readOnly />
                  <CustomSelect
                    options={[
                      { value: 'PERCENTAGE', label: 'Percentage (%)' },
                      { value: 'FIXED', label: 'Fixed (QAR)' },
                    ]}
                    value={modalDiscountType}
                    onChange={(val) => setModalDiscountType(val)}
                    placeholder="Select type"
                  />
                </div>
                <div>
                  <label className={labelCls}>Discount Value</label>
                  <input name="discountValue" type="number" step="0.01" min="0" required defaultValue="0" className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Min Order (QAR)</label>
                  <input name="minOrderAmount" type="number" step="0.01" min="0" defaultValue="0" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Max Discount (QAR)</label>
                  <input name="maxDiscount" type="number" step="0.01" min="0" defaultValue="0" className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Usage Limit</label>
                <input name="usageLimit" type="number" min="1" defaultValue="100" className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Valid From</label>
                  <input name="validFrom" type="date" required className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Expiry Date</label>
                  <input name="validTo" type="date" required className={inputCls} />
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={() => setCreateModal(false)} className="px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors cursor-pointer">
                  Cancel
                </button>
                <button type="submit" disabled={createMutation.isPending} className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50 cursor-pointer">
                  {createMutation.isPending ? 'Creating...' : 'Create Coupon'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 border border-gray-200 dark:border-slate-700">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-500/20">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Delete Coupon</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-slate-400 mb-6">
              Delete coupon <span className="font-mono font-bold text-gray-900 dark:text-white">{deleteConfirm.code}</span>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm font-medium rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700 transition-all cursor-pointer">Cancel</button>
              <button type="button" onClick={() => deleteMutation.mutate(deleteConfirm.id)} disabled={deleteMutation.isPending} className="px-4 py-2 text-sm font-medium rounded-xl bg-red-600 hover:bg-red-700 text-white transition-all disabled:opacity-50 cursor-pointer">
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
