'use client';

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useToast } from '@/components/toast';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import CustomSelect from '@/components/custom-select';
import { Search, ChevronLeft, ChevronRight, CheckCircle, Download, CreditCard, Sparkles, Wallet, Clock, Info, Undo2, AlertTriangle, X } from 'lucide-react';
import { getApiError } from '@/lib/api-error';

interface Payment {
  id: string;
  amount: string;
  gatewayTxnId: string | null;
  status: string;
  payoutStatus: string;
  paidAt: string | null;
  method: string;
  createdAt: string;
  // Server-computed flag: if the vendor has a non-terminal payout request
  // covering this payment, mark-as-paid is blocked here and admin must
  // resolve it on the Payout Requests page first.
  inflightRequest: { status: 'PENDING' | 'APPROVED' } | null;
  booking: {
    ref: string;
    totalPrice: string;
    serviceFee: string;
    commissionAmount: string;
    // Loyalty + coupon fields so the payouts row can explain a 0-cash
    // payment (Wanasa-funded) and the CSV export can reconcile the
    // nominal value against the cash column.
    pointsRedeemed?: number | null;
    pointsDiscount?: string | null;
    couponDiscount?: string | null;
    currencyCode: string;
    vendor: { id: string; businessNameEn: string } | null;
    customer: { fullName: string } | null;
    activity: { titleEn: string } | null;
  } | null;
}

interface PayoutsResponse {
  data: Payment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** Bookings already paid for by the customer whose activity has NOT happened
   *  yet. Deliberately not listed above — a vendor is only paid once the
   *  activity is delivered — but surfaced so future money is visible rather
   *  than silently missing. */
  upcomingCount?: number;
  /** When the earliest of those becomes payable. */
  upcomingFrom?: string | null;
}

function TableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-16 bg-gray-100 dark:bg-slate-800/60 rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

function toCsv(data: any[]): string {
  if (data.length === 0) return '';
  // Wanasa columns are added alongside the existing Vendor Share / Total
  // Charged columns so finance can reconcile: Total Charged (cash) +
  // Wanasa Value (points redeemed) should equal Nominal Total.
  const rows = data.map((p) => {
    const pts = Number(p.booking?.pointsRedeemed ?? 0);
    const ptsValue = Number(p.booking?.pointsDiscount ?? 0);
    const couponValue = Number(p.booking?.couponDiscount ?? 0);
    // Nominal = totalPrice + couponDiscount. totalPrice now carries the
    // full vendor value for every booking regardless of payment method, so
    // pointsDiscount (customer-side saving) must NOT be added.
    const nominal = Number(p.booking?.totalPrice ?? 0) + couponValue;
    return {
      'Booking Ref': p.booking?.ref ?? '',
      'Vendor': p.booking?.vendor?.businessNameEn ?? '',
      'Activity': p.booking?.activity?.titleEn ?? '',
      'Customer': p.booking?.customer?.fullName ?? '',
      'Vendor Share': p.booking ? (Number(p.booking.totalPrice) - Number(p.booking.commissionAmount ?? 0)).toFixed(2) : '',
      'Platform Fee': p.booking ? (Number(p.booking.serviceFee) + Number(p.booking.commissionAmount ?? 0)).toFixed(2) : '',
      'Commission': p.booking?.commissionAmount ?? '0',
      'Total Charged': p.amount,
      'Nominal Total': nominal.toFixed(2),
      'Wanasa Points Used': pts,
      'Wanasa Value': ptsValue.toFixed(2),
      'Currency': p.booking?.currencyCode ?? '',
      'Method': p.method,
      'Payout Status': p.payoutStatus ?? 'UNPAID',
      'Date': new Date(p.createdAt).toISOString().slice(0, 10),
    };
  });
  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(','),
    ...rows.map((r: any) => headers.map((h) => `"${String(r[h]).replace(/"/g, '""')}"`).join(',')),
  ];
  return csvLines.join('\n');
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PaymentsTab() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput);
  // Method filter: 'all' shows everything; 'cash' hides Wanasa-funded rows
  // so the admin sees only bookings that actually need a bank transfer;
  // 'wanasa' isolates points-settled bookings for audit.
  const [methodFilter, setMethodFilter] = useState<'all' | 'cash' | 'wanasa'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Pending "revert to unpaid" confirmation. Holds the full payment so the
  // modal can show ref/amount/vendor without re-fetching.
  const [revertTarget, setRevertTarget] = useState<Payment | null>(null);
  // §M4 — mark-paid confirmation modal. Captures the bank-side wire
  // confirmation number that the server now requires on every mark-paid
  // call (forensic / dispute resolution: every system-PAID row links to
  // a real bank transaction).
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [bankTransferRef, setBankTransferRef] = useState('');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<PayoutsResponse>({
    queryKey: ['admin', 'payouts', page, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (search) params.set('search', search);
      const { data } = await api.get(`/admin/payouts?${params}`);
      return data;
    },
    staleTime: 30_000,
  });

  const markPaidMutation = useMutation({
    mutationFn: async (args: { paymentIds: string[]; bankTransferRef: string }) => {
      // §M4 — bankTransferRef is REQUIRED on the server side. Sending it
      // on every call (with the trimmed ref captured from the modal) keeps
      // the audit row populated with the real wire confirmation number.
      await api.post('/admin/payouts/mark-paid', args);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'payouts'] });
      setSelected(new Set());
      setMarkPaidOpen(false);
      setBankTransferRef('');
      toast('Payouts marked as paid');
    },
    // Surface the server's typed blocker message so admin sees "Vendor X has
    // an in-flight payout request..." instead of a generic failure.
    onError: (err) => { toast(getApiError(err, 'Failed to mark payouts as paid'), 'error'); },
  });

  // Revert-to-unpaid. Single-row (no bulk) — the confirmation modal already
  // spells out the impact; the audit log auto-stamps "mistake revert" so no
  // free-form reason is required. Server blocks if the payment is locked in
  // an APPROVED/COMPLETED payout request.
  const markUnpaidMutation = useMutation({
    mutationFn: async (paymentId: string) => {
      await api.post('/admin/payouts/mark-unpaid', { paymentId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'payouts'] });
      setRevertTarget(null);
      toast('Payout reverted to Unpaid');
    },
    onError: (err) => { toast(getApiError(err, 'Failed to revert payout'), 'error'); },
  });

  const handleExport = useCallback(async () => {
    try {
      const { data: allPayouts } = await api.get('/admin/payouts/export');
      const csv = toCsv(allPayouts);
      downloadCsv(csv, `payouts-${new Date().toISOString().slice(0, 10)}.csv`);
      toast('Payout report exported');
    } catch {
      toast('Failed to export payouts', 'error');
    }
  }, [toast]);

  // A row is "actionable" when admin can legitimately wire cash to the
  // vendor: payoutStatus=UNPAID AND the vendor's share is non-zero.
  // Under the current accounting model, Wanasa-paid bookings ALSO carry a
  // non-zero vendor share (platform backs the points with cash float, so
  // the vendor earns their normal commission regardless of payment method),
  // so Wanasa rows are ACTIONABLE just like PAY2M rows. The method badge
  // still distinguishes them in the UI, but the payout action is the same.
  const isActionable = useCallback((payment: Payment) => {
    if (payment.payoutStatus === 'PAID') return false;
    // Locked by an in-flight payout request — admin must use the Payout
    // Requests workflow instead of bulk-flipping here. Keeps the request
    // record and the payment state consistent.
    if (payment.inflightRequest) return false;
    const vendorShare =
      Number(payment.booking?.totalPrice ?? 0) -
      Number(payment.booking?.commissionAmount ?? 0);
    return vendorShare > 0;
  }, []);

  // Rows the user sees, post-filter. Keeps the "visible set" and
  // "actionable set" decoupled so the method filter + select-all behave
  // predictably together.
  const visibleRows = useMemo(() => {
    if (!data) return [];
    return data.data.filter((p) => {
      if (methodFilter === 'cash') return p.method !== 'WANASA_POINTS';
      if (methodFilter === 'wanasa') return p.method === 'WANASA_POINTS';
      return true;
    });
  }, [data, methodFilter]);

  const actionableVisible = useMemo(
    () => visibleRows.filter(isActionable),
    [visibleRows, isActionable],
  );

  // Summary strip computed from the full dataset (not the visible filter).
  // Admin wants to see "what's actually outstanding" regardless of current
  // filter view.
  //
  // IMPORTANT accounting note: Wanasa-paid bookings also contribute to
  // `cashToWire` because the vendor is owed their commission in cash even
  // when the customer paid via points (platform covers it from the float
  // it collected on previous cash bookings). The third card tracks Wanasa
  // customer-spend separately as an audit metric — it OVERLAPS with
  // cashToWire/alreadyPaid, it's not additive.
  const summary = useMemo(() => {
    const rows = data?.data ?? [];
    let cashToWire = 0;
    let cashToWireCount = 0;
    let alreadyPaid = 0;
    let alreadyPaidCount = 0;
    let wanasaSpend = 0;
    let wanasaSpendCount = 0;
    for (const p of rows) {
      const vendorShare =
        Number(p.booking?.totalPrice ?? 0) -
        Number(p.booking?.commissionAmount ?? 0);
      if (p.payoutStatus === 'PAID') {
        alreadyPaidCount += 1;
        alreadyPaid += vendorShare;
      } else if (vendorShare > 0) {
        cashToWireCount += 1;
        cashToWire += vendorShare;
      }
      if (p.method === 'WANASA_POINTS') {
        wanasaSpendCount += 1;
        // pointsDiscount is the QAR value of points the customer spent.
        wanasaSpend += Number(p.booking?.pointsDiscount ?? 0);
      }
    }
    return { cashToWire, cashToWireCount, alreadyPaid, alreadyPaidCount, wanasaSpend, wanasaSpendCount };
  }, [data]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    // Select-all covers only the actionable-visible set. Wanasa rows and
    // already-paid rows are excluded so admin can't accidentally mass-flip
    // them. If every actionable-visible is already selected, toggle clears.
    const actionableIds = actionableVisible.map((p) => p.id);
    const allSelected = actionableIds.length > 0 && actionableIds.every((id) => selected.has(id));
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(actionableIds));
    }
  };

  return (
    <div>
      {/* ─── In-escrow notice ──────────────────────────────────
          This table lists what is PAYABLE NOW — a vendor is paid only after
          the activity has taken place, because a customer can still cancel
          before it starts. Without this line, prepaid future bookings would
          simply be absent with no explanation, and "where is my payout?"
          would be indistinguishable from money going missing. */}
      {!!data?.upcomingCount && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-sky-200/70 dark:border-sky-900/40 bg-sky-50/60 dark:bg-sky-900/10 p-4">
          <div className="h-10 w-10 rounded-xl bg-sky-500/15 flex items-center justify-center shrink-0">
            <Clock className="h-5 w-5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
          </div>
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-sky-900 dark:text-sky-200">
              {data.upcomingCount} booking{data.upcomingCount === 1 ? '' : 's'} not payable yet
            </p>
            <p className="text-sky-800/80 dark:text-sky-300/80">
              Paid by the customer, but the activity has not taken place. They appear here once it has
              {data.upcomingFrom
                ? ` — the earliest on ${new Date(data.upcomingFrom).toLocaleDateString()}.`
                : '.'}
            </p>
          </div>
        </div>
      )}

      {/* ─── Summary bar ───────────────────────────────────────
          Three counters so admin can tell at a glance: how much cash
          remains to be wired, how much has already been paid out, and how
          many bookings settled without any cash action (fully Wanasa). */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="p-4 rounded-2xl border border-amber-200/70 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-900/10 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
            <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-500">Awaiting payout</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums truncate">
              {summary.cashToWire.toLocaleString()} QAR
            </p>
            <p className="text-xs text-amber-600/70 dark:text-amber-400/60">{summary.cashToWireCount} booking{summary.cashToWireCount === 1 ? '' : 's'}</p>
          </div>
        </div>
        <div className="p-4 rounded-2xl border border-emerald-200/70 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-900/10 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
            <Wallet className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-500">Already paid out</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums truncate">
              {summary.alreadyPaid.toLocaleString()} QAR
            </p>
            <p className="text-xs text-emerald-600/70 dark:text-emerald-400/60">{summary.alreadyPaidCount} booking{summary.alreadyPaidCount === 1 ? '' : 's'}</p>
          </div>
        </div>
        <div className="p-4 rounded-2xl border border-purple-200/70 dark:border-purple-900/40 bg-purple-50/60 dark:bg-purple-900/10 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-purple-500/15 flex items-center justify-center shrink-0">
            <Sparkles className="h-5 w-5 text-purple-600 dark:text-purple-400" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-purple-700 dark:text-purple-500">Wanasa redemption volume</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums truncate">
              {summary.wanasaSpend.toLocaleString()} QAR
            </p>
            <p className="text-xs text-purple-600/70 dark:text-purple-400/60">
              {summary.wanasaSpendCount} booking{summary.wanasaSpendCount === 1 ? '' : 's'} · points liability reduced
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex flex-1 w-full items-center gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="absolute inset-s-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-slate-500" />
            <input
              type="text"
              placeholder="Search payments..."
              value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); setPage(1); }}
              className="w-full ps-10 pe-4 py-2.5 bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
          </div>
          <CustomSelect
            options={[
              { value: 'cash', label: 'Cash only' },
              { value: 'wanasa', label: 'Wanasa only' },
            ]}
            value={methodFilter === 'all' ? '' : methodFilter}
            onChange={(val) => setMethodFilter((val || 'all') as 'all' | 'cash' | 'wanasa')}
            placeholder="All methods"
          />
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button
              type="button"
              data-testid="mark-paid-button"
              onClick={() => setMarkPaidOpen(true)}
              disabled={markPaidMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-xl transition-all"
            >
              <CreditCard className="h-4 w-4" />
              Mark {selected.size} as Paid
            </button>
          )}
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-300 text-sm font-medium rounded-xl transition-all"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : (
        <div className="rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-800">
                  <th className="px-4 py-4 w-10">
                    <input
                      type="checkbox"
                      onChange={toggleAll}
                      // Indeterminate checkbox logic: checked only when every
                      // actionable-visible row is in the selection set.
                      checked={actionableVisible.length > 0 && actionableVisible.every((p) => selected.has(p.id))}
                      disabled={actionableVisible.length === 0}
                      className="rounded"
                      title="Select all actionable rows (excludes Wanasa-funded and already-paid)"
                    />
                  </th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Booking</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Vendor / Activity</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Customer</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Booking Value</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Payment Breakdown</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Vendor Share</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Platform</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                {visibleRows.length === 0 && (
                  <tr><td colSpan={9} className="px-6 py-12 text-center text-gray-400 dark:text-slate-500">
                    {data?.data.length === 0
                      ? (data?.upcomingCount
                          ? `No payouts are due yet. ${data.upcomingCount} booking${data.upcomingCount === 1 ? '' : 's'} become payable once the activity has taken place.`
                          : 'No payments found.')
                      : 'No payments match the current method filter.'}
                  </td></tr>
                )}
                {visibleRows.map((payment) => {
                  // Per-row computations. Pulled out of the JSX so the
                  // rendered cells stay readable and the math is in one
                  // place (reconcilable against the summary bar above).
                  const currency = payment.booking?.currencyCode ?? 'QAR';
                  const isWanasa = payment.method === 'WANASA_POINTS';
                  const actionable = isActionable(payment);
                  const pointsUsed = Number(payment.booking?.pointsRedeemed ?? 0);
                  const pointsValue = Number(payment.booking?.pointsDiscount ?? 0);
                  const couponValue = Number(payment.booking?.couponDiscount ?? 0);
                  const cashCollected = Number(payment.amount);
                  // Nominal activity value. totalPrice carries the full
                  // vendor value for every booking (cash, Wanasa, mixed),
                  // so we add couponDiscount only. pointsDiscount is a
                  // customer-side saving — adding it would double-count.
                  const nominal =
                    Number(payment.booking?.totalPrice ?? 0) + couponValue;
                  const vendorShare =
                    Number(payment.booking?.totalPrice ?? 0) -
                    Number(payment.booking?.commissionAmount ?? 0);
                  const platformTake =
                    Number(payment.booking?.serviceFee ?? 0) +
                    Number(payment.booking?.commissionAmount ?? 0);

                  return (
                    <tr
                      key={payment.id}
                      data-testid={`payment-row-${payment.id}`}
                      className={`transition-colors ${
                        isWanasa
                          ? 'bg-purple-50/30 dark:bg-purple-900/5 hover:bg-purple-50/50 dark:hover:bg-purple-900/10'
                          : 'hover:bg-gray-50/50 dark:hover:bg-slate-800/30'
                      }`}
                    >
                      <td className="px-4 py-4">
                        {/* Actionable rows (UNPAID + non-zero vendor share +
                            no in-flight request) get a checkbox regardless
                            of payment method. Already-paid rows show a
                            check; rows locked in a payout request show a
                            clock with a tooltip pointing admin to the
                            Payout Requests page. */}
                        {actionable ? (
                          <input
                            type="checkbox"
                            checked={selected.has(payment.id)}
                            onChange={() => toggleSelect(payment.id)}
                            className="rounded"
                          />
                        ) : payment.payoutStatus === 'PAID' ? (
                          <CheckCircle className="h-4 w-4 text-emerald-500" aria-label="Already paid" />
                        ) : payment.inflightRequest ? (
                          <span
                            title={
                              payment.inflightRequest.status === 'PENDING'
                                ? 'Vendor has a pending payout request — approve or reject it on the Payout Requests page first.'
                                : 'Locked by an approved payout request — use the Complete action on the Payout Requests page.'
                            }
                          >
                            <Clock className="h-4 w-4 text-amber-500" aria-hidden="true" />
                          </span>
                        ) : (
                          <span title="No vendor share to pay out on this row (zero-value booking)">
                            <Info className="h-4 w-4 text-gray-400 dark:text-slate-500" aria-hidden="true" />
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-1 rounded-md">
                          {payment.booking?.ref ?? '—'}
                        </span>
                        <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">
                          {new Date(payment.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-gray-900 dark:text-white font-medium truncate max-w-[180px]">{payment.booking?.vendor?.businessNameEn ?? '—'}</p>
                        <p className="text-xs text-gray-500 dark:text-slate-400 truncate max-w-[180px]">{payment.booking?.activity?.titleEn ?? '—'}</p>
                      </td>
                      <td className="px-6 py-4 text-gray-700 dark:text-slate-300 text-xs truncate max-w-[140px]">
                        {payment.booking?.customer?.fullName ?? '—'}
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums">
                          {nominal.toLocaleString()} {currency}
                        </p>
                        <p className="text-[10px] text-gray-400 dark:text-slate-500">nominal activity value</p>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-0.5 text-xs">
                          {/* Cash = customer's out-of-pocket via PAY2M. For
                              Wanasa-only bookings this is 0. */}
                          <div className="flex items-center justify-between gap-2 min-w-[140px]">
                            <span className="text-gray-500 dark:text-slate-400">Cash</span>
                            <span className="font-medium text-gray-900 dark:text-white tabular-nums">
                              {cashCollected.toLocaleString()} {currency}
                            </span>
                          </div>
                          {pointsUsed > 0 && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1 text-purple-600 dark:text-purple-400">
                                <Sparkles className="h-3 w-3" aria-hidden="true" />
                                {pointsUsed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pts
                              </span>
                              <span className="font-medium text-purple-600 dark:text-purple-400 tabular-nums">
                                {pointsValue.toLocaleString()} {currency}
                              </span>
                            </div>
                          )}
                          {couponValue > 0 && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-emerald-600 dark:text-emerald-400">Coupon</span>
                              <span className="font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">
                                {couponValue.toLocaleString()} {currency}
                              </span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {/* Vendor share displays the same way regardless of
                            payment method — the vendor is owed this amount
                            in cash whether the customer paid via PAY2M or
                            via redeemed Wanasa points. The method badge in
                            the Status column is where the payment-method
                            distinction is surfaced. */}
                        {vendorShare <= 0 ? (
                          <span className="text-sm text-gray-400 dark:text-slate-500">—</span>
                        ) : (
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                            {vendorShare.toLocaleString()} {currency}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-500 dark:text-slate-400">
                        <p className="tabular-nums">{platformTake.toLocaleString()} {currency}</p>
                        <p className="text-[10px] text-gray-400 dark:text-slate-500">fee + commission</p>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col items-start gap-1">
                          {/* Method badge — always shown so the payment
                              method is never ambiguous. */}
                          {isWanasa ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400">
                              <Sparkles className="h-3 w-3" aria-hidden="true" />
                              Wanasa
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400">
                              <CreditCard className="h-3 w-3" aria-hidden="true" />
                              Cash
                            </span>
                          )}
                          {/* Payout status is displayed the same way for
                              cash- and Wanasa-paid bookings — both owe the
                              vendor a cash payout, so the flow is identical.
                              PAID rows get a subtle "Revert" affordance in
                              case admin marked it paid by mistake — gated
                              by a confirmation modal with mandatory reason. */}
                          {payment.payoutStatus === 'PAID' ? (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                <CheckCircle className="h-3 w-3" aria-hidden="true" /> Paid
                              </span>
                              <button
                                type="button"
                                onClick={() => setRevertTarget(payment)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                                title="Revert this payout back to Unpaid"
                              >
                                <Undo2 className="h-3 w-3" aria-hidden="true" />
                                Revert
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                <Clock className="h-3 w-3" aria-hidden="true" /> Unpaid
                              </span>
                              {/* Locked-by-request chip — tells admin exactly
                                  where to go to resolve this payment without
                                  making them discover it by trial-and-error. */}
                              {payment.inflightRequest ? (
                                <Link
                                  href="/admin/payout-requests"
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors"
                                  title={
                                    payment.inflightRequest.status === 'PENDING'
                                      ? 'Vendor has a pending payout request — review on the Payout Requests page.'
                                      : 'Locked by an approved payout request — complete on the Payout Requests page.'
                                  }
                                >
                                  <Clock className="h-3 w-3" aria-hidden="true" />
                                  {payment.inflightRequest.status === 'PENDING' ? 'Pending request' : 'Approved request'}
                                </Link>
                              ) : null}
                            </div>
                          )}
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

      {/* Revert-to-Unpaid modal. Destructive financial action — red CTA +
          explicit warning about vendor impact so admin reads before clicking.
          The server blocks reverting rows locked in an APPROVED/COMPLETED
          payout request and surfaces that as a toast error. The audit log
          auto-stamps "mistake revert" as the motive. */}
      {revertTarget && (() => {
        const ref = revertTarget.booking?.ref ?? '—';
        const vendorShare =
          Number(revertTarget.booking?.totalPrice ?? 0) -
          Number(revertTarget.booking?.commissionAmount ?? 0);
        const currency = revertTarget.booking?.currencyCode ?? 'QAR';
        const vendorName = revertTarget.booking?.vendor?.businessNameEn ?? '—';
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => !markUnpaidMutation.isPending && setRevertTarget(null)}
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
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Revert payout to Unpaid?</h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-slate-400 leading-relaxed">
                      Use this only if you marked the payout as paid by mistake
                      and the bank transfer never actually happened. It reopens{' '}
                      <span className="font-semibold text-gray-700 dark:text-slate-200">{vendorShare.toFixed(2)} {currency}</span>{' '}
                      as owed to{' '}
                      <span className="font-medium text-gray-700 dark:text-slate-200 wrap-break-word">{vendorName}</span>.
                      The vendor is notified and the amount reappears in their pending balance.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => !markUnpaidMutation.isPending && setRevertTarget(null)}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="px-6 pb-3">
                <div className="rounded-xl bg-gray-50 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-700/50 p-3 text-xs text-gray-600 dark:text-slate-300 space-y-0.5">
                  <p><span className="text-gray-400 dark:text-slate-500">Booking:</span> <span className="font-mono">{ref}</span></p>
                  <p><span className="text-gray-400 dark:text-slate-500">Vendor share:</span> <span className="font-semibold tabular-nums">{vendorShare.toFixed(2)} {currency}</span></p>
                </div>
                <p className="mt-3 text-[11px] text-gray-400 dark:text-slate-500">
                  This action is recorded in the admin audit log with your account.
                </p>
              </div>
              <div className="px-6 pb-6 pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setRevertTarget(null)}
                  disabled={markUnpaidMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-50"
                >
                  Keep as Paid
                </button>
                <button
                  type="button"
                  onClick={() => markUnpaidMutation.mutate(revertTarget.id)}
                  disabled={markUnpaidMutation.isPending}
                  className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                >
                  <Undo2 className="h-4 w-4" aria-hidden="true" />
                  {markUnpaidMutation.isPending ? 'Reverting...' : 'Revert to Unpaid'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* §M4 — Mark-paid confirmation modal. Captures the bank-side wire
          confirmation number so the admin can never click "Mark as Paid"
          on a settlement without recording how the cash actually moved. */}
      {markPaidOpen && (() => {
        const trimmedRef = bankTransferRef.trim();
        const refValid = trimmedRef.length >= 3 && trimmedRef.length <= 120;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => !markPaidMutation.isPending && setMarkPaidOpen(false)}
          >
            <div
              className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between p-6 pb-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-11 w-11 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <CreditCard className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                      Mark {selected.size} payout{selected.size === 1 ? '' : 's'} as paid?
                    </h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-slate-400 leading-relaxed">
                      Confirm only after the bank transfer has actually settled. The vendor will
                      be notified and these rows will move to <span className="font-semibold text-gray-700 dark:text-slate-200">Paid</span>.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => !markPaidMutation.isPending && setMarkPaidOpen(false)}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="px-6 pb-3">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700 dark:text-slate-300">
                    Bank transfer reference
                  </span>
                  <span className="ms-1 text-red-500">*</span>
                  <input
                    type="text"
                    data-testid="bank-transfer-ref-input"
                    value={bankTransferRef}
                    onChange={(e) => setBankTransferRef(e.target.value)}
                    placeholder="e.g. SWIFT-MT103-XYZ-0099"
                    minLength={3}
                    maxLength={120}
                    autoFocus
                    disabled={markPaidMutation.isPending}
                    className="mt-1.5 block w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 disabled:opacity-50"
                  />
                </label>
                <p className="mt-2 text-[11px] text-gray-400 dark:text-slate-500">
                  Required. Stored on every flipped payment row + audit log so disputes can
                  trace each PAID record back to a real bank transaction.
                </p>
              </div>
              <div className="px-6 pb-6 pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setMarkPaidOpen(false)}
                  disabled={markPaidMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="mark-paid-confirm"
                  onClick={() => markPaidMutation.mutate({
                    paymentIds: Array.from(selected),
                    bankTransferRef: trimmedRef,
                  })}
                  disabled={markPaidMutation.isPending || !refValid}
                  className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                >
                  <CreditCard className="h-4 w-4" aria-hidden="true" />
                  {markPaidMutation.isPending ? 'Marking...' : 'Mark as Paid'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
