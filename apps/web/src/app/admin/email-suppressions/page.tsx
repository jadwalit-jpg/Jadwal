'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { useToast } from '@/components/toast';
import AdminLayout from '../_components/admin-layout';
import { ChevronLeft, ChevronRight, MailX, Trash2, Search, Loader2, ShieldAlert } from 'lucide-react';

interface Suppression {
  emailHash: string;        // SHA-256 hex (64 chars)
  reason: string;           // BOUNCE | COMPLAINT | MANUAL
  bounceType: string | null;
  notes: string | null;
  createdAt: string;
}

interface SuppressionsResponse {
  items: Suppression[];
  total: number;
  page: number;
  limit: number;
  counts: Record<string, number>; // { BOUNCE, COMPLAINT, MANUAL }
}

type ReasonFilter = 'ALL' | 'BOUNCE' | 'COMPLAINT' | 'MANUAL';

const REASON_STYLES: Record<string, string> = {
  BOUNCE: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-900/50',
  COMPLAINT: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-900/50',
  MANUAL: 'bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-200 dark:border-gray-700',
};

/** Compute SHA-256 hex digest of a string using the Web Crypto API. */
async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default function EmailSuppressionsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [reason, setReason] = useState<ReasonFilter>('ALL');
  const [searchEmail, setSearchEmail] = useState('');
  const [searching, setSearching] = useState(false);
  const [confirmHash, setConfirmHash] = useState<string | null>(null);
  const limit = 50;

  // ─── List query ──────────────────────────────────────────────────────
  const { data, isLoading, isError } = useQuery<SuppressionsResponse>({
    queryKey: ['admin', 'email-suppressions', page, limit, reason],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (reason !== 'ALL') params.set('reason', reason);
      return api.get(`/admin/email-suppressions?${params}`).then((r) => r.data);
    },
    staleTime: 30_000,
  });

  // ─── Unsuppress mutation ─────────────────────────────────────────────
  const unsuppress = useMutation({
    mutationFn: (hash: string) =>
      api.delete(`/admin/email-suppressions/${hash}`).then((r) => r.data),
    onSuccess: (res: { removed: boolean }) => {
      if (res.removed) {
        toast('Email removed from suppression list.', 'success');
      } else {
        // Idempotent backend response — hash wasn't in the table. Treat as
        // a benign success ("already not suppressed") since the desired
        // outcome (address is reachable) is achieved either way.
        toast('Hash was not in the suppression list — already reachable.', 'success');
      }
      setConfirmHash(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'email-suppressions'] });
    },
    onError: (err: unknown) => {
      toast(getApiError(err, 'Failed to remove suppression.'), 'error');
    },
  });

  // ─── Search-by-email handler ─────────────────────────────────────────
  // Computes SHA-256(email.trim().toLowerCase()) client-side and calls
  // DELETE with the hash. Plaintext email never leaves the browser.
  const handleSearchUnsuppress = useCallback(async () => {
    const raw = searchEmail.trim().toLowerCase();
    if (!raw) {
      toast('Enter an email address to remove.', 'error');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      toast('Invalid email format.', 'error');
      return;
    }
    setSearching(true);
    try {
      const hash = await sha256Hex(raw);
      setConfirmHash(hash);
      setSearchEmail('');
    } catch {
      toast('Could not compute hash. Try again.', 'error');
    } finally {
      setSearching(false);
    }
  }, [searchEmail, toast]);

  const totalPages = useMemo(
    () => (data ? Math.max(1, Math.ceil(data.total / limit)) : 1),
    [data, limit],
  );

  return (
    <AdminLayout
      title="Email Suppressions"
      subtitle="Emails blocked from outbound mail due to bounces, complaints, or manual flags."
    >
      <div className="space-y-6">
        {/* Counts strip — per-reason totals over the full table (not filtered).
            Doubles as filter chips: click a chip to scope the list to that
            reason; click "All" to clear. Counts come from the same response
            as the page items (single round-trip via Prisma groupBy). */}
        {data && (
          <div className="flex flex-wrap items-center gap-2">
            <ReasonChip
              label="All"
              count={(data.counts.BOUNCE ?? 0) + (data.counts.COMPLAINT ?? 0) + (data.counts.MANUAL ?? 0)}
              active={reason === 'ALL'}
              onClick={() => { setReason('ALL'); setPage(1); }}
              iconColor="text-gray-500"
            />
            <ReasonChip
              label="Bounces"
              count={data.counts.BOUNCE ?? 0}
              active={reason === 'BOUNCE'}
              onClick={() => { setReason('BOUNCE'); setPage(1); }}
              iconColor="text-orange-500"
            />
            <ReasonChip
              label="Complaints"
              count={data.counts.COMPLAINT ?? 0}
              active={reason === 'COMPLAINT'}
              onClick={() => { setReason('COMPLAINT'); setPage(1); }}
              iconColor="text-red-500"
            />
            <ReasonChip
              label="Manual"
              count={data.counts.MANUAL ?? 0}
              active={reason === 'MANUAL'}
              onClick={() => { setReason('MANUAL'); setPage(1); }}
              iconColor="text-gray-400"
            />
          </div>
        )}

        {/* Search bar — paste plaintext email to unsuppress by hash */}
        <div className="rounded-xl bg-white dark:bg-slate-900/60 border border-gray-100 dark:border-slate-800 p-4">
          <label className="text-xs font-medium text-gray-700 dark:text-slate-300 mb-2 block">
            Unsuppress a specific address
          </label>
          <div className="flex gap-2">
            <input
              type="email"
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearchUnsuppress();
              }}
              placeholder="customer@example.com"
              disabled={searching}
              className="flex-1 px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleSearchUnsuppress}
              disabled={searching || !searchEmail.trim()}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Look up
            </button>
          </div>
          <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-2 leading-relaxed">
            Hash is computed in your browser (SHA-256 of the lowercased address). The plaintext
            email never leaves this page — the server only knows hashes.
          </p>
        </div>

        {/* Table */}
        <div className="rounded-xl bg-white dark:bg-slate-900/60 border border-gray-100 dark:border-slate-800 overflow-hidden">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-14 bg-gray-100 dark:bg-slate-800/60 rounded-lg animate-pulse"
                />
              ))}
            </div>
          ) : isError ? (
            <div className="p-12 text-center text-sm text-red-600 dark:text-red-400">
              Failed to load suppression list.
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="p-12 text-center text-sm text-gray-400 dark:text-slate-500">
              No suppressed emails. The list is empty — every recipient is reachable.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-800/40 text-xs font-semibold uppercase text-gray-500 dark:text-slate-400">
                  <tr>
                    <th className="text-start px-4 py-3">Hash</th>
                    <th className="text-start px-4 py-3">Reason</th>
                    <th className="text-start px-4 py-3">Type</th>
                    <th className="text-start px-4 py-3">Notes</th>
                    <th className="text-start px-4 py-3">Suppressed</th>
                    <th className="text-end px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {data.items.map((s) => (
                    <tr
                      key={s.emailHash}
                      className="hover:bg-gray-50 dark:hover:bg-slate-800/30 transition"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-gray-700 dark:text-slate-300">
                        <span title={s.emailHash}>{s.emailHash.slice(0, 12)}…</span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${
                            REASON_STYLES[s.reason] ?? REASON_STYLES.MANUAL
                          }`}
                        >
                          {s.reason}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">
                        {s.bounceType ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-slate-300 max-w-xs truncate">
                        {s.notes ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">
                        {new Date(s.createdAt).toLocaleString('en-GB')}
                      </td>
                      <td className="px-4 py-3 text-end">
                        <button
                          type="button"
                          onClick={() => setConfirmHash(s.emailHash)}
                          disabled={unsuppress.isPending}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-700 dark:text-red-400 transition disabled:opacity-50 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Unsuppress
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {data && data.items.length > 0 && totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-100 dark:border-slate-800 flex items-center justify-between text-xs text-gray-500 dark:text-slate-400">
              <span>
                Page {data.page} of {totalPages} · {data.total} entries
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirm-unsuppress modal */}
      {confirmHash && (
        <ConfirmUnsuppressModal
          hash={confirmHash}
          isPending={unsuppress.isPending}
          onConfirm={() => unsuppress.mutate(confirmHash)}
          onCancel={() => setConfirmHash(null)}
        />
      )}
    </AdminLayout>
  );
}

function ReasonChip({
  label,
  count,
  active,
  onClick,
  iconColor,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  iconColor: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-sm font-medium transition cursor-pointer ${
        active
          ? 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400'
          : 'bg-white dark:bg-slate-900/60 border-gray-200 dark:border-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800'
      }`}
    >
      <MailX className={`h-3.5 w-3.5 ${iconColor}`} aria-hidden="true" />
      <span>{label}</span>
      <span className={`text-xs font-bold tabular-nums ${active ? 'text-blue-600 dark:text-blue-300' : 'text-gray-500 dark:text-slate-400'}`}>
        {count}
      </span>
    </button>
  );
}

function ConfirmUnsuppressModal({
  hash,
  isPending,
  onConfirm,
  onCancel,
}: {
  hash: string;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsuppress-title"
    >
      <div
        ref={dialogRef}
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 w-full max-w-md p-6"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-xl bg-orange-100 dark:bg-orange-900/30">
            <ShieldAlert className="h-5 w-5 text-orange-600 dark:text-orange-400" />
          </div>
          <h3 id="unsuppress-title" className="text-lg font-semibold text-gray-900 dark:text-white">
            Remove from suppression list?
          </h3>
        </div>
        <p className="text-sm text-gray-600 dark:text-slate-400 mb-2">
          The next outbound email to this address will be attempted again. If the underlying
          deliverability issue (full mailbox, blocked domain, hard bounce) hasn&apos;t been resolved,
          SES will re-add it on the next bounce.
        </p>
        <p className="text-xs font-mono text-gray-400 dark:text-slate-500 mb-6 break-all">
          {hash}
        </p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition disabled:opacity-50 flex items-center gap-2 cursor-pointer"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Unsuppress
          </button>
        </div>
      </div>
    </div>
  );
}
