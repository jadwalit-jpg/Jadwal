'use client';

import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { sanitize } from '@/lib/validation';
import { useToast } from '@/components/toast';
import AdminLayout from '../_components/admin-layout';
import {
  Search, ChevronLeft, ChevronRight, X, Award, Coins, Sliders, Users,
  Edit3, Save, Loader2, Plus, Minus,
} from 'lucide-react';
import CustomSelect from '@/components/custom-select';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LoyaltyConfig {
  pointsPerQar: number;
  qarPerPoint: number;
  minRedemption: number;
}

interface LoyaltyUser {
  id: string;
  fullName: string;
  email: string;
  loyaltyPoints: number;
}

interface LoyaltyUsersResponse {
  data: LoyaltyUser[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─── Skeletons ────────────────────────────────────────────────────────────────

function ConfigSkeleton() {
  return (
    <div className="rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 p-6 space-y-4 animate-pulse">
      <div className="h-6 w-40 bg-gray-100 dark:bg-slate-800 rounded-lg" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 bg-gray-100 dark:bg-slate-800/60 rounded-xl" />
        ))}
      </div>
    </div>
  );
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

// ─── Mask email ────────────────────────────────────────────────────────────────

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  const visible = local.length <= 3 ? local.charAt(0) : local.slice(0, 3);
  return `${visible}***@${domain}`;
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function AdminLoyaltyPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ─── Config state ─────────────────────────────────────
  const [editingConfig, setEditingConfig] = useState(false);
  const [configForm, setConfigForm] = useState<LoyaltyConfig>({ pointsPerQar: 0, qarPerPoint: 0, minRedemption: 0 });

  // ─── Users state ──────────────────────────────────────
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Sort direction on loyaltyPoints. 'desc' = most → least (default).
  // Server whitelists this field, so no injection risk from ad-hoc strings.
  const [sort, setSort] = useState<'desc' | 'asc'>('desc');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ─── Adjust modal state ───────────────────────────────
  const [adjustModal, setAdjustModal] = useState<LoyaltyUser | null>(null);
  const [adjustMode, setAdjustMode] = useState<'add' | 'deduct'>('add');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

  // ─── Config query ─────────────────────────────────────
  const { data: config, isLoading: configLoading } = useQuery<LoyaltyConfig>({
    queryKey: ['admin', 'loyalty', 'config'],
    queryFn: () => api.get('/admin/loyalty/config').then(r => r.data),
    staleTime: 60_000,
  });

  const configMutation = useMutation({
    mutationFn: (payload: LoyaltyConfig) =>
      api.patch('/admin/loyalty/config', payload).then(r => r.data),
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin', 'loyalty', 'config'], updated);
      setEditingConfig(false);
      toast('Loyalty config updated successfully');
    },
    onError: (err) => toast(getApiError(err, 'Failed to update config'), 'error'),
  });

  const startEditConfig = useCallback(() => {
    if (!config) return;
    // Extract only the 3 editable fields (NOT a `{ ...config }` spread):
    //   - The Prisma record carries `id` + `updatedAt` which the backend DTO
    //     rejects via `forbidNonWhitelisted: true` → 400 Bad Request.
    //   - Prisma serializes Decimal columns as JSON strings ("1.0000"); the
    //     DTO requires `@IsNumber()`, so we Number()-coerce here so a save
    //     without edits doesn't ship strings.
    setConfigForm({
      pointsPerQar:  Number(config.pointsPerQar),
      qarPerPoint:   Number(config.qarPerPoint),
      minRedemption: Number(config.minRedemption),
    });
    setEditingConfig(true);
  }, [config]);

  const handleSaveConfig = useCallback(() => {
    if (configForm.pointsPerQar < 0 || configForm.qarPerPoint < 0 || configForm.minRedemption < 0) {
      toast('Values must be positive', 'error');
      return;
    }
    configMutation.mutate(configForm);
  }, [configForm, configMutation, toast]);

  // ─── Users query ──────────────────────────────────────
  const handleSearch = useCallback((val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedSearch(val); setPage(1); }, 300);
  }, []);

  const { data: usersData, isLoading: usersLoading } = useQuery<LoyaltyUsersResponse>({
    queryKey: ['admin', 'loyalty', 'users', page, debouncedSearch, sort],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      // 10 per page so admin can paginate instead of scrolling — matches
      // the other admin list pages that use smaller page sizes for density.
      params.set('limit', '10');
      params.set('sort', sort);
      if (debouncedSearch) params.set('search', debouncedSearch);
      const { data } = await api.get(`/admin/loyalty/users?${params}`);
      return data;
    },
  });

  // ─── Adjust mutation ──────────────────────────────────
  const adjustMutation = useMutation({
    mutationFn: async ({ userId, delta, reason }: { userId: string; delta: number; reason: string }) => {
      await api.patch(`/admin/loyalty/users/${userId}/points`, { delta, reason: sanitize(reason) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'loyalty', 'users'] });
      setAdjustModal(null);
      setAdjustAmount('');
      setAdjustReason('');
      toast('Points adjusted successfully');
    },
    onError: (err) => toast(getApiError(err, 'Failed to adjust points'), 'error'),
  });

  const handleAdjustSubmit = useCallback(() => {
    if (!adjustModal) return;
    const amount = parseInt(adjustAmount, 10);
    if (!amount || amount <= 0) {
      toast('Enter a valid positive number', 'error');
      return;
    }
    if (!adjustReason.trim()) {
      toast('Please provide a reason', 'error');
      return;
    }
    const delta = adjustMode === 'deduct' ? -amount : amount;
    adjustMutation.mutate({ userId: adjustModal.id, delta, reason: adjustReason.trim() });
  }, [adjustModal, adjustAmount, adjustReason, adjustMode, adjustMutation, toast]);

  const openAdjustModal = useCallback((user: LoyaltyUser) => {
    setAdjustModal(user);
    setAdjustMode('add');
    setAdjustAmount('');
    setAdjustReason('');
  }, []);

  return (
    <AdminLayout title="Loyalty (WANASA)" subtitle="Platform loyalty points program">
      {/* ─── Section A: Config Card ──────────────────────── */}
      {configLoading ? (
        <ConfigSkeleton />
      ) : config ? (
        <div className="rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 p-6 mb-8">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <Sliders className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Loyalty Config</h2>
                <p className="text-xs text-gray-400 dark:text-slate-500">Points earning and redemption rules</p>
              </div>
            </div>
            {!editingConfig ? (
              <button
                type="button"
                onClick={startEditConfig}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-all cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                Edit
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditingConfig(false)}
                  className="p-2 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleSaveConfig}
                  disabled={configMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-all disabled:opacity-60 cursor-pointer"
                >
                  {configMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {configMutation.isPending ? 'Saving...' : 'Save'}
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Points per QAR */}
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <Coins className="h-4 w-4 text-amber-500" />
                <p className="text-xs font-medium text-gray-500 dark:text-slate-400">Points per QAR Spent</p>
              </div>
              {editingConfig ? (
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={configForm.pointsPerQar}
                  onChange={(e) => setConfigForm(f => ({ ...f, pointsPerQar: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-shadow"
                />
              ) : (
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{config.pointsPerQar}</p>
              )}
              <p className="mt-2 text-[11px] leading-snug text-gray-400 dark:text-slate-500">
                Points a customer <strong>earns</strong> for every 1 QAR spent on a booking. Example: 1 = the customer gets 1 point per QAR paid.
              </p>
            </div>

            {/* QAR per Point */}
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <Award className="h-4 w-4 text-blue-500" />
                <p className="text-xs font-medium text-gray-500 dark:text-slate-400">QAR per Point</p>
              </div>
              {editingConfig ? (
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={configForm.qarPerPoint}
                  onChange={(e) => setConfigForm(f => ({ ...f, qarPerPoint: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-shadow"
                />
              ) : (
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{config.qarPerPoint}</p>
              )}
              <p className="mt-2 text-[11px] leading-snug text-gray-400 dark:text-slate-500">
                How much each point is <strong>worth</strong> when redeemed, and the rate used to convert refunds to points. Refund credit = refund amount ÷ this value (rounded down). Example: 0.1 → 10 points = 1 QAR; a 1 QAR refund at 0.1 = 10 points. If this is larger than the refund (e.g. 2), a 1 QAR refund rounds down to 0 points.
              </p>
            </div>

            {/* Min Redemption */}
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <Award className="h-4 w-4 text-emerald-500" />
                <p className="text-xs font-medium text-gray-500 dark:text-slate-400">Min Redemption (pts)</p>
              </div>
              {editingConfig ? (
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={configForm.minRedemption}
                  onChange={(e) => setConfigForm(f => ({ ...f, minRedemption: parseInt(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-shadow"
                />
              ) : (
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{config.minRedemption}</p>
              )}
              <p className="mt-2 text-[11px] leading-snug text-gray-400 dark:text-slate-500">
                Fewest points a customer must spend in one booking before points can be redeemed. Stops tiny &ldquo;dust&rdquo; redemptions. Example: 100 = a customer needs at least 100 points to apply any discount.
              </p>
            </div>
          </div>

          {/* Worked example — how the two rates combine into "1% back" */}
          <div className="mt-4 p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50">
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1.5">
              Example — give 1 QAR of points per 100 QAR spent (1% back)
            </p>
            <ul className="space-y-1 text-[11px] leading-snug text-blue-700/90 dark:text-blue-300/90">
              <li><strong>Points per QAR = 1</strong> → a 100 QAR booking earns floor(100 × 1) = <strong>100 points</strong></li>
              <li><strong>QAR per Point = 0.01</strong> → 100 points × 0.01 = <strong>1 QAR worth</strong> ✅</li>
            </ul>
            <p className="mt-2 text-[11px] leading-snug text-blue-700/70 dark:text-blue-300/70">
              Rule of thumb: <strong>Points per QAR × QAR per Point = 0.01</strong> → 1% back. Points are credited <strong>after the booking is completed</strong>, not at payment.
            </p>
          </div>
        </div>
      ) : null}

      {/* ─── Section B: Users Leaderboard ────────────────── */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <Users className="h-5 w-5 text-blue-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Points Leaderboard</h2>
        </div>
        <p className="text-xs text-gray-400 dark:text-slate-500 mb-4">All users sorted by loyalty points balance</p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute inset-s-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-slate-500" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full ps-10 pe-4 py-2.5 bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
          />
        </div>

        {/* Sort filter — toggles the loyaltyPoints ordering. Label mirrors
            the server-side whitelist: 'desc' (most → least, default) and
            'asc' (least → most). `required` hides the clear row because
            sort always has a meaningful selected state. Reset to page 1
            on change so the admin doesn't land on an empty tail page. */}
        <div className="min-w-[180px]">
          <CustomSelect
            options={[
              { value: 'desc', label: 'Most points first' },
              { value: 'asc', label: 'Least points first' },
            ]}
            value={sort}
            onChange={(v) => { setSort((v as 'desc' | 'asc') || 'desc'); setPage(1); }}
            required
            placeholder="Sort by points"
          />
        </div>
      </div>

      {/* Table */}
      {usersLoading ? (
        <TableSkeleton />
      ) : (
        <div className="rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-800">
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">#</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">User</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Email</th>
                  <th className="text-end px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Points Balance</th>
                  <th className="text-end px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                {usersData?.data.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-400 dark:text-slate-500">
                      No users found.
                    </td>
                  </tr>
                )}
                {usersData?.data.map((user, idx) => (
                  <tr key={user.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 text-gray-400 dark:text-slate-500 text-xs font-medium">
                      {((usersData.page - 1) * usersData.limit) + idx + 1}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-linear-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-xs font-bold shadow-sm">
                          {user.fullName.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-gray-900 dark:text-white">{user.fullName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-500 dark:text-slate-400">
                      {maskEmail(user.email)}
                    </td>
                    <td className="px-6 py-4 text-end">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${
                        user.loyaltyPoints > 0
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : 'bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-slate-500'
                      }`}>
                        <Award className="h-3.5 w-3.5" />
                        {user.loyaltyPoints.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-end">
                      <button
                        type="button"
                        onClick={() => openAdjustModal(user)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 hover:border-blue-300 dark:hover:border-blue-700 transition-all cursor-pointer"
                      >
                        <Sliders className="h-3 w-3" />
                        Adjust
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {usersData && usersData.totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-slate-800">
              <p className="text-xs text-gray-500 dark:text-slate-400">
                Showing {((usersData.page - 1) * usersData.limit) + 1}&ndash;{Math.min(usersData.page * usersData.limit, usersData.total)} of {usersData.total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-all cursor-pointer"
                >
                  <ChevronLeft className="h-4 w-4 text-gray-600 dark:text-slate-400" />
                </button>
                <span className="text-xs text-gray-600 dark:text-slate-400 font-medium">
                  {usersData.page} / {usersData.totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(usersData.totalPages, p + 1))}
                  disabled={page >= usersData.totalPages}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-all cursor-pointer"
                >
                  <ChevronRight className="h-4 w-4 text-gray-600 dark:text-slate-400" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Adjust Points Modal ─────────────────────────── */}
      {adjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 p-6 max-w-md w-full mx-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900/30">
                  <Award className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Adjust Points</h3>
                  <p className="text-xs text-gray-400 dark:text-slate-500">{adjustModal.fullName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAdjustModal(null)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Current balance */}
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-700/50 mb-5">
              <p className="text-xs text-gray-400 dark:text-slate-500">Current Balance</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{adjustModal.loyaltyPoints.toLocaleString()} pts</p>
            </div>

            {/* Add / Deduct toggle */}
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setAdjustMode('add')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border-2 transition-all cursor-pointer ${
                  adjustMode === 'add'
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                    : 'border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-600'
                }`}
              >
                <Plus className="h-4 w-4" />
                Add
              </button>
              <button
                type="button"
                onClick={() => setAdjustMode('deduct')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border-2 transition-all cursor-pointer ${
                  adjustMode === 'deduct'
                    ? 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                    : 'border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-600'
                }`}
              >
                <Minus className="h-4 w-4" />
                Deduct
              </button>
            </div>

            {/* Amount */}
            <label className="block mb-4">
              <span className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5 block">Points Amount</span>
              <input
                type="number"
                min="1"
                step="1"
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(e.target.value)}
                placeholder="e.g. 100"
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-shadow"
              />
            </label>

            {/* Reason */}
            <label className="block mb-5">
              <span className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5 block">Reason</span>
              <input
                type="text"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="e.g. Promotional bonus, manual correction..."
                maxLength={200}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-shadow"
              />
            </label>

            {/* Preview */}
            {adjustAmount && parseInt(adjustAmount) > 0 && (
              <div className="p-3 rounded-xl bg-gray-50 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-700/50 mb-5 text-center">
                <p className="text-xs text-gray-400 dark:text-slate-500 mb-1">New Balance</p>
                <p className={`text-lg font-bold ${
                  adjustMode === 'add' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                }`}>
                  {(adjustModal.loyaltyPoints + (adjustMode === 'add' ? parseInt(adjustAmount) : -parseInt(adjustAmount))).toLocaleString()} pts
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setAdjustModal(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdjustSubmit}
                disabled={adjustMutation.isPending || !adjustAmount || !adjustReason.trim()}
                className={`px-4 py-2 text-sm font-semibold text-white rounded-xl transition-all disabled:opacity-50 cursor-pointer flex items-center gap-1.5 ${
                  adjustMode === 'add'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {adjustMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {adjustMode === 'add' ? 'Add Points' : 'Deduct Points'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
