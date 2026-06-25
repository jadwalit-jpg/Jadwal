'use client';

import { pickBadge, type UserRole } from '@/lib/status-config';

import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { useToast } from '@/components/toast';
import AdminLayout from '../_components/admin-layout';
import { Search, ChevronLeft, ChevronRight, Shield, UserCircle, ShieldCheck, Ban, CheckCircle, Trash2, AlertTriangle, Download, MailCheck, MailWarning, BadgeCheck } from 'lucide-react';
import CustomSelect from '@/components/custom-select';

interface User {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: 'CUSTOMER' | 'VENDOR' | 'ADMIN';
  isDeactivated: boolean;
  emailVerified: boolean;
  createdAt: string;
  termsAcceptedAt: string | null;
  termsAcceptedVersion: string | null;
  deletedAt: string | null;
}

interface UsersResponse {
  data: User[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const roleBadge: Record<UserRole, { bg: string; text: string; icon: React.ElementType }> = {
  ADMIN: { bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400', icon: ShieldCheck },
  VENDOR: { bg: 'bg-violet-500/10', text: 'text-violet-600 dark:text-violet-400', icon: Shield },
  CUSTOMER: { bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', icon: UserCircle },
};

function TableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-14 bg-gray-100 dark:bg-slate-800/60 rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

export default function AdminUsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [verifiedFilter, setVerifiedFilter] = useState<'' | 'verified' | 'unverified'>('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id?: string; name?: string; count?: number; ids?: string[] } | null>(null);
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

  const { data, isLoading } = useQuery<UsersResponse>({
    queryKey: ['admin', 'users', page, debouncedSearch, roleFilter, verifiedFilter, showDeleted],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (debouncedSearch) params.set('search', debouncedSearch);
      // Send the role filter under its accurate name `role` (backend also still
      // accepts the legacy `status` alias). Matches the export call below.
      if (roleFilter) params.set('role', roleFilter);
      if (verifiedFilter) params.set('verified', verifiedFilter);
      if (showDeleted) params.set('includeDeleted', 'true');
      const { data } = await api.get(`/admin/users?${params}`);
      return data;
    },
  });

  const roleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      await api.patch(`/admin/users/${userId}/role`, { role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-stats'] });
      toast('User role updated successfully');
    },
    onError: () => { toast('Failed to update user role', 'error'); },
  });

  const deactivateMutation = useMutation({
    mutationFn: async ({ userId, isDeactivated }: { userId: string; isDeactivated: boolean }) => {
      await api.patch(`/admin/users/${userId}/deactivate`, { isDeactivated });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast(variables.isDeactivated ? 'User deactivated successfully' : 'User reactivated successfully');
    },
    onError: () => { toast('Failed to update user status', 'error'); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (userId: string) => {
      await api.delete(`/admin/users/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-stats'] });
      setDeleteConfirm(null);
      toast('User deleted successfully');
    },
    onError: (error) => {
      toast(getApiError(error, 'Failed to delete user'), 'error');
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (userIds: string[]) => {
      await api.post('/admin/bulk/users/delete', { userIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-stats'] });
      setSelected(new Set());
      toast('Users deleted successfully');
    },
    onError: (error) => { toast(getApiError(error, 'Failed to delete users'), 'error'); },
  });

  const handleExport = useCallback(async () => {
    // Policy: no mixed-role exports. Admin must pick one role before exporting.
    if (!roleFilter) {
      toast('Select a role first — exports are scoped to a single role', 'error');
      return;
    }
    try {
      const { data } = await api.get(`/admin/export/users?role=${roleFilter}`);
      if (!data || data.length === 0) {
        toast('No users match the current filter', 'error');
        return;
      }
      const rows = data.map((u: any) => ({
        Name: u.fullName, Email: u.email, Phone: u.phone ?? '', Role: u.role,
        Active: u.isDeactivated ? 'No' : 'Yes', Joined: new Date(u.createdAt).toISOString().slice(0, 10),
      }));
      const headers = Object.keys(rows[0]);
      const csv = [headers.join(','), ...rows.map((r: any) => headers.map((h) => `"${String(r[h]).replace(/"/g, '""')}"`).join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Role-specific filename: customers-2026-04-12.csv / vendors-.../ admins-...
      const rolePrefix = roleFilter.toLowerCase() + 's';
      a.download = `${rolePrefix}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`${rolePrefix.charAt(0).toUpperCase() + rolePrefix.slice(1)} exported`);
    } catch { toast('Failed to export users', 'error'); }
  }, [toast, roleFilter]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  return (
    <AdminLayout title="Users" subtitle="Manage all platform users">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex flex-1 items-center flex-wrap gap-3 w-full">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-slate-500" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full ps-10 pe-4 py-2.5 bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
          </div>
          {/* Role filter — segmented buttons (all options visible, no dropdown) */}
          <div className="inline-flex items-center rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-1 shadow-sm">
            {[
              { value: '', label: 'All' },
              { value: 'CUSTOMER', label: 'Customer' },
              { value: 'VENDOR', label: 'Vendor' },
              { value: 'ADMIN', label: 'Admin' },
            ].map((opt) => {
              const isActive = roleFilter === opt.value;
              return (
                <button
                  key={opt.value || 'all'}
                  type="button"
                  onClick={() => { setRoleFilter(opt.value); setPage(1); }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {/* Email verification filter — pairs with the role filter (mainly for CUSTOMER) */}
          <div className="inline-flex items-center rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-1 shadow-sm">
            {[
              { value: '', label: 'Any email' },
              { value: 'verified', label: 'Verified' },
              { value: 'unverified', label: 'Unverified' },
            ].map((opt) => {
              const isActive = verifiedFilter === opt.value;
              return (
                <button
                  key={opt.value || 'any'}
                  type="button"
                  onClick={() => { setVerifiedFilter(opt.value as '' | 'verified' | 'unverified'); setPage(1); }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {/* Reveal soft-deleted (anonymised) users — retained for audit, hidden by default */}
          <button
            type="button"
            onClick={() => { setShowDeleted((v) => !v); setPage(1); }}
            className={`px-3.5 py-2 rounded-xl border text-xs font-medium transition-all shadow-sm ${
              showDeleted
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800'
            }`}
          >
            Show deleted
          </button>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setDeleteConfirm({ count: selected.size, ids: Array.from(selected) })}
              disabled={bulkDeleteMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-xl transition-all"
            >
              <Trash2 className="h-4 w-4" /> Delete {selected.size}
            </button>
          )}
          <button
            type="button"
            onClick={handleExport}
            disabled={!roleFilter}
            title={roleFilter ? `Export ${roleFilter.toLowerCase()}s to CSV` : 'Select a role first — exports are scoped to a single role'}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-300 text-sm font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-100 dark:disabled:hover:bg-slate-800"
          >
            <Download className="h-4 w-4" /> Export{roleFilter ? ` ${roleFilter.charAt(0) + roleFilter.slice(1).toLowerCase()}s` : ''}
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
                  <th className="px-4 py-4 w-10">
                    <input type="checkbox" onChange={() => {
                      if (!data) return;
                      const nonAdmins = data.data.filter((u) => u.role !== 'ADMIN').map((u) => u.id);
                      if (selected.size === nonAdmins.length) setSelected(new Set());
                      else setSelected(new Set(nonAdmins));
                    }} checked={data?.data.length ? selected.size === data.data.filter((u) => u.role !== 'ADMIN').length && selected.size > 0 : false} className="rounded" />
                  </th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">User</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Phone</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Role</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Joined</th>
                  <th className="text-end px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                {data?.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-400 dark:text-slate-500">
                      No users found.
                    </td>
                  </tr>
                )}
                {data?.data.map((user) => {
                  const badge = pickBadge(roleBadge, user.role, roleBadge.CUSTOMER);
                  const BadgeIcon = badge.icon;
                  return (
                    <tr key={user.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-4">
                        {user.role !== 'ADMIN' ? (
                          <input type="checkbox" checked={selected.has(user.id)} onChange={() => toggleSelect(user.id)} className="rounded" />
                        ) : <span />}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-sm">
                            {user.fullName.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="font-medium text-gray-900 dark:text-white wrap-break-word max-w-[180px]">{user.fullName}</p>
                              {user.termsAcceptedAt && !user.deletedAt && (
                                <span
                                  title={`Accepted Terms & Privacy${user.termsAcceptedVersion ? ` · v${user.termsAcceptedVersion}` : ''} · ${new Date(user.termsAcceptedAt).toLocaleDateString()}`}
                                  className="inline-flex shrink-0 text-sky-500"
                                >
                                  <BadgeCheck className="h-4 w-4" aria-label="Accepted Terms" />
                                </span>
                              )}
                              {user.deletedAt && (
                                <span className="inline-flex shrink-0 items-center px-1.5 py-0.5 rounded-md bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-slate-300 text-[10px] font-semibold uppercase tracking-wide">
                                  Deleted
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 max-w-[240px]">
                              <p className="text-xs text-gray-400 dark:text-slate-500 wrap-break-word truncate">{user.email}</p>
                              {/* Vendors don't go through email verification — only show the
                                  verified/unverified icon for non-vendor accounts. */}
                              {user.role !== 'VENDOR' && (user.emailVerified ? (
                                <span title="Email verified" className="inline-flex shrink-0 text-emerald-500">
                                  <MailCheck className="h-3.5 w-3.5" />
                                </span>
                              ) : (
                                <span title="Email NOT verified" className="inline-flex shrink-0 text-amber-500">
                                  <MailWarning className="h-3.5 w-3.5" />
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-600 dark:text-slate-300">
                        {user.phone || '—'}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${badge.bg} ${badge.text}`}>
                          <BadgeIcon className="h-3.5 w-3.5" />
                          {user.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-500 dark:text-slate-400 text-xs">
                        {new Date(user.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>
                      <td className="px-6 py-4 text-end">
                        <div className="flex items-center justify-end gap-2">
                          {user.role === 'ADMIN' ? (
                            <span className="text-xs text-gray-400 dark:text-slate-500 italic">Protected</span>
                          ) : (
                            <>
                              <CustomSelect
                                options={[
                                  { value: 'CUSTOMER', label: 'Customer' },
                                  { value: 'VENDOR', label: 'Vendor' },
                                  { value: 'ADMIN', label: 'Admin' },
                                ]}
                                value={user.role}
                                onChange={(val) => roleMutation.mutate({ userId: user.id, role: val })}
                                disabled={roleMutation.isPending}
                              />
                              <button
                                type="button"
                                onClick={() => deactivateMutation.mutate({ userId: user.id, isDeactivated: !user.isDeactivated })}
                                disabled={deactivateMutation.isPending}
                                className={`p-1.5 rounded-lg transition-all cursor-pointer ${user.isDeactivated ? 'text-emerald-600 hover:bg-emerald-500/10' : 'text-red-500 hover:bg-red-500/10'}`}
                                title={user.isDeactivated ? 'Reactivate user' : 'Deactivate user'}
                              >
                                {user.isDeactivated ? <CheckCircle className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteConfirm({ id: user.id, name: user.fullName })}
                                className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 transition-all cursor-pointer"
                                title="Delete user"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-slate-800">
              <p className="text-xs text-gray-500 dark:text-slate-400">
                Showing {((data.page - 1) * data.limit) + 1}–{Math.min(data.page * data.limit, data.total)} of {data.total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-all"
                >
                  <ChevronLeft className="h-4 w-4 text-gray-600 dark:text-slate-400" />
                </button>
                <span className="text-xs text-gray-600 dark:text-slate-400 font-medium">
                  {data.page} / {data.totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                  disabled={page >= data.totalPages}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-all"
                >
                  <ChevronRight className="h-4 w-4 text-gray-600 dark:text-slate-400" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{deleteConfirm.ids ? 'Delete Users' : 'Delete User'}</h3>
            </div>
            {deleteConfirm.name ? (
              <>
                <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">
                  Are you sure you want to delete <span className="font-semibold text-gray-900 dark:text-white">{deleteConfirm.name}</span>?
                </p>
                <p className="text-xs text-red-600 dark:text-red-400 mb-6">
                  This will permanently delete the user and all their associated data. This action cannot be undone.
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-600 dark:text-slate-400 mb-6">Delete {deleteConfirm.count} user(s)? This cannot be undone.</p>
            )}
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
                onClick={() => {
                  if (deleteConfirm.ids) bulkDeleteMutation.mutate(deleteConfirm.ids);
                  else if (deleteConfirm.id) deleteMutation.mutate(deleteConfirm.id);
                  setDeleteConfirm(null);
                }}
                disabled={deleteMutation.isPending || bulkDeleteMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50 cursor-pointer"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
