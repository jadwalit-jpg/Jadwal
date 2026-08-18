'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { sanitize } from '@/lib/validation';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useToast } from '@/components/toast';
import CustomSelect from '@/components/custom-select';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  DollarSign,
  Landmark,
  Building2,
  AlertCircle,
  AlertTriangle,
  CheckCheck,
  Undo2,
  X,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PayoutRequest {
  id: string;
  vendorId: string;
  amount: string;
  currency: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
  adminNote: string | null;
  paymentIds: string[];
  processedAt: string | null;
  createdAt: string;
  vendor: {
    id: string;
    businessNameEn: string;
    businessNameAr: string | null;
    slug: string;
    // Sanitised by the server — full IBAN/account name are NOT sent to the
    // listing endpoint to avoid credential exposure via screenshots/screen
    // sharing on the admin UI. If admin needs the full destination, they
    // open the vendor's settings page.
    bankDetails: { hasBankDetails: boolean; bankName: string | null } | null;
  } | null;
}

interface PayoutRequestsResponse {
  data: PayoutRequest[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Note length cap mirrors the backend DTO (@MaxLength(500) on ProcessPayoutRequestDto).
// Kept in lock-step with the server so frontend validation never lets a request through
// that the server would reject — defensive but not decorative.
const ADMIN_NOTE_MAX_LENGTH = 500;

const STATUS_CONFIG: Record<PayoutRequest['status'], { label: string; bg: string; text: string; icon: React.ElementType }> = {
  PENDING:   { label: 'Pending review',    bg: 'bg-amber-500/10',    text: 'text-amber-600 dark:text-amber-400',       icon: Clock },
  APPROVED:  { label: 'Approved · wiring', bg: 'bg-blue-500/10',     text: 'text-blue-600 dark:text-blue-400',         icon: CheckCircle2 },
  COMPLETED: { label: 'Completed',         bg: 'bg-emerald-500/10',  text: 'text-emerald-600 dark:text-emerald-400',   icon: CheckCheck },
  REJECTED:  { label: 'Rejected',          bg: 'bg-red-500/10',      text: 'text-red-600 dark:text-red-400',           icon: XCircle },
};

// ─── Skeleton ────────────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-20 bg-gray-100 dark:bg-slate-800/60 rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function RequestsTab() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [actionModal, setActionModal] = useState<
    | { request: PayoutRequest; action: 'APPROVED' | 'REJECTED' | 'COMPLETED' }
    | null
  >(null);
  const [noteInput, setNoteInput] = useState('');
  // Revert-action modal state. Holds the request being reverted plus the
  // admin's selected target status. Target options are whitelisted on both
  // client and server (see RevertPayoutRequestDto).
  const [revertTarget, setRevertTarget] = useState<PayoutRequest | null>(null);
  const [revertStatus, setRevertStatus] = useState<'PENDING' | 'APPROVED'>('PENDING');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Key is inline-versioned (status filter + search + page) so each view
  // caches independently and invalidation hits them all cleanly after a
  // mutation.
  const { data, isLoading } = useQuery<PayoutRequestsResponse>({
    queryKey: ['admin', 'payout-requests', page, search, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      const { data } = await api.get(`/admin/payout-requests?${params}`);
      return data;
    },
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: async ({ id, action, note }: { id: string; action: 'APPROVED' | 'REJECTED' | 'COMPLETED'; note?: string }) => {
      await api.patch(`/admin/payout-requests/${id}`, { action, adminNote: note });
    },
    onSuccess: (_data, vars) => {
      // Force refetch even if the list page is inactive — matches the
      // invalidation pattern used elsewhere in the admin UI.
      queryClient.invalidateQueries({ queryKey: ['admin', 'payout-requests'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-stats'], refetchType: 'all' });
      const label = vars.action === 'APPROVED' ? 'approved' : vars.action === 'REJECTED' ? 'rejected' : 'completed';
      toast(`Payout request ${label}`, 'success');
      setActionModal(null);
      setNoteInput('');
    },
    onError: (err) => {
      toast(getApiError(err, 'Failed to process payout request'), 'error');
    },
  });

  const openAction = useCallback((request: PayoutRequest, action: 'APPROVED' | 'REJECTED' | 'COMPLETED') => {
    setActionModal({ request, action });
    setNoteInput('');
  }, []);

  // Revert mutation — re-opens a closed request. Destructive (un-settles a
  // record other code treats as final), so lower-cadence rate limiter on
  // the server (RATE_LIMIT_STRICT, 3/min). Typed error codes surface via
  // getApiError.
  const revertMutation = useMutation({
    mutationFn: async ({ id, targetStatus }: { id: string; targetStatus: 'PENDING' | 'APPROVED' }) => {
      await api.post(`/admin/payout-requests/${id}/revert`, { targetStatus });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'payout-requests'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['admin', 'payouts'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-stats'], refetchType: 'all' });
      toast('Payout request reverted', 'success');
      setRevertTarget(null);
    },
    onError: (err) => {
      toast(getApiError(err, 'Failed to revert payout request'), 'error');
    },
  });

  // Which revert targets are valid for a given source status. Mirrors the
  // whitelist inside adminService.revertPayoutRequest so the UI doesn't
  // offer options that will always 400.
  const allowedRevertTargets = useCallback((status: PayoutRequest['status']): Array<'PENDING' | 'APPROVED'> => {
    if (status === 'COMPLETED') return ['PENDING', 'APPROVED'];
    if (status === 'APPROVED') return ['PENDING'];
    if (status === 'REJECTED') return ['PENDING'];
    return [];
  }, []);

  const openRevert = useCallback((request: PayoutRequest) => {
    const options = allowedRevertTargets(request.status);
    setRevertTarget(request);
    // Default to the "safest" option (PENDING for full rewind) unless only
    // APPROVED is offered — that only happens for COMPLETED, where both
    // are valid and PENDING is the broader rollback.
    setRevertStatus(options[0] ?? 'PENDING');
  }, [allowedRevertTargets]);

  const confirmAction = useCallback(() => {
    if (!actionModal) return;
    // Client-side defence-in-depth: sanitize against XSS before POST. The
    // backend SanitizePipe is the source-of-truth, this just reduces the
    // chance of malformed payloads round-tripping.
    const cleanNote = noteInput.trim()
      ? sanitize(noteInput.trim()).slice(0, ADMIN_NOTE_MAX_LENGTH)
      : undefined;
    mutation.mutate({ id: actionModal.request.id, action: actionModal.action, note: cleanNote });
  }, [actionModal, noteInput, mutation]);

  // Summary cards — compute from current page only (admin gets overall
  // totals from the dashboard page). Keeps this page fast even with many
  // requests.
  const pageStats = useMemo(() => {
    const rows = data?.data ?? [];
    const pending = rows.filter((r) => r.status === 'PENDING').length;
    const approved = rows.filter((r) => r.status === 'APPROVED').length;
    const pendingAmount = rows
      .filter((r) => r.status === 'PENDING')
      .reduce((sum, r) => sum + Number(r.amount), 0);
    const approvedAmount = rows
      .filter((r) => r.status === 'APPROVED')
      .reduce((sum, r) => sum + Number(r.amount), 0);
    return { pending, approved, pendingAmount, approvedAmount };
  }, [data]);

  return (
    <div>
      {/* ─── Filter bar ──────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex flex-1 items-center gap-3 w-full">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-slate-500" />
            <input
              type="text"
              placeholder="Search by vendor name..."
              value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); setPage(1); }}
              className="w-full ps-10 pe-4 py-2.5 bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
          </div>
          <CustomSelect
            options={[
              { value: 'PENDING', label: 'Pending' },
              { value: 'APPROVED', label: 'Approved' },
              { value: 'COMPLETED', label: 'Completed' },
              { value: 'REJECTED', label: 'Rejected' },
            ]}
            value={statusFilter}
            onChange={(val) => { setStatusFilter(val); setPage(1); }}
            placeholder="All Statuses"
          />
        </div>
      </div>

      {/* ─── Page-level counters ─────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="p-4 rounded-2xl border border-amber-200/70 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-900/10 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
            <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-500">
              Awaiting review (this page)
            </p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">
              {pageStats.pending} · QAR {pageStats.pendingAmount.toLocaleString()}
            </p>
          </div>
        </div>
        <div className="p-4 rounded-2xl border border-blue-200/70 dark:border-blue-900/40 bg-blue-50/60 dark:bg-blue-900/10 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-blue-500/15 flex items-center justify-center">
            <CheckCircle2 className="h-5 w-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-500">
              Approved · bank transfer pending
            </p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">
              {pageStats.approved} · QAR {pageStats.approvedAmount.toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {/* ─── Table ───────────────────────────────────── */}
      {isLoading ? (
        <TableSkeleton />
      ) : (
        <div className="rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-800">
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Vendor</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Amount</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Bank details</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Requested</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="text-end px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                {data?.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-400 dark:text-slate-500">
                      No payout requests match the current filter.
                    </td>
                  </tr>
                )}
                {data?.data.map((req) => {
                  const cfg = STATUS_CONFIG[req.status] ?? STATUS_CONFIG.PENDING;
                  const StatusIcon = cfg.icon;
                  const bank = req.vendor?.bankDetails;
                  return (
                    <tr
                      key={req.id}
                      className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <p className="font-medium text-gray-900 dark:text-white">{req.vendor?.businessNameEn ?? '—'}</p>
                        {req.vendor?.businessNameAr ? (
                          <p className="text-xs text-gray-400 dark:text-slate-500" dir="rtl">{req.vendor.businessNameAr}</p>
                        ) : null}
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-gray-900 dark:text-white">
                          <DollarSign className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                          {Number(req.amount).toLocaleString()} {req.currency}
                        </span>
                        <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">
                          {req.paymentIds.length} payment{req.paymentIds.length === 1 ? '' : 's'}
                        </p>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-600 dark:text-slate-300">
                        {/* IBAN + account name deliberately NOT rendered here
                            (see server-side sanitiser on getPayoutRequests).
                            Shows bank NAME + a "set" pill — admin opens the
                            vendor's settings page for the full destination. */}
                        {bank?.hasBankDetails ? (
                          <div className="space-y-1 max-w-[240px] truncate">
                            <p className="inline-flex items-center gap-1 truncate">
                              <Building2 className="h-3 w-3 text-gray-400 dark:text-slate-500" aria-hidden="true" />
                              {bank.bankName ?? 'Bank set'}
                            </p>
                            {req.vendor?.slug ? (
                              <a
                                href={`/admin/vendors`}
                                className="inline-flex items-center gap-1 text-[11px] text-sky-600 dark:text-sky-400 hover:underline"
                              >
                                <Landmark className="h-3 w-3" aria-hidden="true" />
                                View destination in vendor settings
                              </a>
                            ) : null}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-500">
                            <AlertCircle className="h-3 w-3" aria-hidden="true" /> No bank details
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-500 dark:text-slate-400">
                        {new Date(req.createdAt).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${cfg.bg} ${cfg.text}`}>
                          <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          {cfg.label}
                        </span>
                        {req.adminNote ? (
                          <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1 max-w-[200px] truncate italic">
                            “{req.adminNote.split('\n')[0]}”
                          </p>
                        ) : null}
                      </td>
                      <td className="px-6 py-4 text-end">
                        {req.status === 'PENDING' ? (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openAction(req, 'REJECTED')}
                              disabled={mutation.isPending}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 border border-red-200 dark:border-red-800/50 transition-colors"
                            >
                              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                              Reject
                            </button>
                            <button
                              type="button"
                              onClick={() => openAction(req, 'APPROVED')}
                              disabled={mutation.isPending}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 shadow-sm transition-colors"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Approve
                            </button>
                          </div>
                        ) : req.status === 'APPROVED' ? (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openRevert(req)}
                              disabled={mutation.isPending || revertMutation.isPending}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-50 border border-gray-200 dark:border-slate-700 transition-colors"
                              title="Revert approval"
                            >
                              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Revert
                            </button>
                            <button
                              type="button"
                              onClick={() => openAction(req, 'COMPLETED')}
                              disabled={mutation.isPending || revertMutation.isPending}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 shadow-sm transition-colors"
                            >
                              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                              Complete request
                            </button>
                          </div>
                        ) : req.status === 'COMPLETED' || req.status === 'REJECTED' ? (
                          <button
                            type="button"
                            onClick={() => openRevert(req)}
                            disabled={mutation.isPending || revertMutation.isPending}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-50 border border-gray-200 dark:border-slate-700 transition-colors"
                            title="Revert this request"
                          >
                            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                            Revert
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400 dark:text-slate-500">—</span>
                        )}
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

      {/* ─── Action modal ────────────────────────────── */}
      {actionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className={`p-2 rounded-full ${
                  actionModal.action === 'APPROVED'
                    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                    : actionModal.action === 'COMPLETED'
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                      : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                }`}>
                  {actionModal.action === 'APPROVED' ? <CheckCircle2 className="h-5 w-5" /> : actionModal.action === 'COMPLETED' ? <CheckCheck className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {actionModal.action === 'APPROVED' && 'Approve payout'}
                  {actionModal.action === 'COMPLETED' && 'Complete payout request'}
                  {actionModal.action === 'REJECTED' && 'Reject payout request'}
                </h3>
              </div>

              <div className="text-sm text-gray-600 dark:text-slate-400 mb-4 space-y-1">
                <p>
                  Vendor: <span className="font-semibold text-gray-900 dark:text-white">{actionModal.request.vendor?.businessNameEn}</span>
                </p>
                <p>
                  Amount: <span className="font-semibold text-gray-900 dark:text-white tabular-nums">
                    {Number(actionModal.request.amount).toLocaleString()} {actionModal.request.currency}
                  </span>
                </p>
                {actionModal.action === 'APPROVED' && (
                  <p className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 text-xs">
                    The amount will be re-verified against current eligible payments and may auto-adjust downward if any underlying booking was refunded since the request was submitted. Funds do NOT move to the vendor on this step — wire manually, then mark completed.
                  </p>
                )}
                {actionModal.action === 'COMPLETED' && (
                  <p className="mt-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 text-xs">
                    This closes the request and releases the lock on its payments, but does NOT mark them paid. After clicking, open the <strong>Payments</strong> tab and click <strong>Mark as Paid</strong> on each row once the bank transfer has actually landed. The two-step split keeps the &quot;money moved&quot; checkpoint separate from the request workflow.
                  </p>
                )}
              </div>

              <div className="mb-5">
                <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
                  {actionModal.action === 'REJECTED' ? 'Reason for rejection' : 'Note'}{' '}
                  <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value.slice(0, ADMIN_NOTE_MAX_LENGTH))}
                  rows={3}
                  placeholder={actionModal.action === 'REJECTED' ? 'Explain why…' : 'Optional audit note…'}
                  className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 resize-none"
                />
                <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">{noteInput.length}/{ADMIN_NOTE_MAX_LENGTH}</p>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setActionModal(null); setNoteInput(''); }}
                  disabled={mutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmAction}
                  disabled={mutation.isPending}
                  className={`px-4 py-2 text-sm font-medium text-white rounded-xl disabled:opacity-50 transition-colors ${
                    actionModal.action === 'APPROVED'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : actionModal.action === 'COMPLETED'
                        ? 'bg-blue-600 hover:bg-blue-700'
                        : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {mutation.isPending
                    ? 'Saving…'
                    : actionModal.action === 'APPROVED'
                      ? 'Approve'
                      : actionModal.action === 'COMPLETED'
                        ? 'Confirm transfer'
                        : 'Reject'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Revert modal — lets admin undo an approve / complete / reject click.
          Target-status select is whitelisted per source status (mirrors the
          server DTO). Same red-alert styling as the mark-unpaid modal on
          the Payments tab since both are "unsettle a closed record". */}
      {revertTarget && (() => {
        const options = allowedRevertTargets(revertTarget.status);
        const vendorName = revertTarget.vendor?.businessNameEn ?? '—';
        const amount = Number(revertTarget.amount);
        const currency = revertTarget.currency;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => !revertMutation.isPending && setRevertTarget(null)}
          >
            <div
              className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between p-6 pb-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-11 w-11 rounded-xl bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                    <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Revert this payout request?</h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-slate-400 leading-relaxed">
                      Use this if the{' '}
                      <span className="font-semibold text-gray-700 dark:text-slate-200">
                        {revertTarget.status.toLowerCase()}
                      </span>{' '}
                      action was taken by mistake. The request for{' '}
                      <span className="font-semibold text-gray-700 dark:text-slate-200">
                        {amount.toFixed(2)} {currency}
                      </span>{' '}
                      from{' '}
                      <span className="font-medium text-gray-700 dark:text-slate-200 wrap-break-word">{vendorName}</span>{' '}
                      will re-open at the selected status and the vendor is notified.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => !revertMutation.isPending && setRevertTarget(null)}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="px-6 pb-3">
                <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
                  Revert to
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['PENDING', 'APPROVED'] as const).map((opt) => {
                    const enabled = options.includes(opt);
                    const selected = revertStatus === opt && enabled;
                    return (
                      <button
                        key={opt}
                        type="button"
                        disabled={!enabled || revertMutation.isPending}
                        onClick={() => setRevertStatus(opt)}
                        className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                          selected
                            ? 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                            : enabled
                              ? 'border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 hover:border-gray-300 dark:hover:border-slate-600'
                              : 'border-gray-100 dark:border-slate-800 text-gray-300 dark:text-slate-600 cursor-not-allowed'
                        }`}
                      >
                        {opt === 'PENDING' ? 'Pending' : 'Approved'}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] text-gray-500 dark:text-slate-500 leading-relaxed">
                  {revertStatus === 'PENDING'
                    ? 'Releases any payment lock and puts the request back in the pending queue for a fresh decision.'
                    : 'Re-opens the request at Approved — the locked payments stay reserved and you can retry the Complete step.'}
                </p>
                <p className="mt-3 text-[11px] text-gray-400 dark:text-slate-500">
                  This action is recorded in the admin audit log with your account.
                </p>
              </div>
              <div className="px-6 pb-6 pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setRevertTarget(null)}
                  disabled={revertMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-50"
                >
                  Keep as {revertTarget.status.toLowerCase()}
                </button>
                <button
                  type="button"
                  onClick={() => revertMutation.mutate({ id: revertTarget.id, targetStatus: revertStatus })}
                  disabled={revertMutation.isPending || options.length === 0}
                  className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                >
                  <Undo2 className="h-4 w-4" aria-hidden="true" />
                  {revertMutation.isPending ? 'Reverting...' : `Revert to ${revertStatus === 'PENDING' ? 'Pending' : 'Approved'}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
