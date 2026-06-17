'use client';

import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { sanitize } from '@/lib/validation';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useToast } from '@/components/toast';
import AdminLayout from '../_components/admin-layout';
import { Search, ChevronLeft, ChevronRight, CheckCircle, Clock, XCircle, CheckCheck, ChevronDown, Tag, CreditCard, Download, AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react';
import CustomSelect from '@/components/custom-select';

interface Booking {
  id: string;
  ref: string;
  guests: number;
  bookingPhone: string;
  totalPrice: string;
  serviceFee: string;
  commissionPct: string;
  commissionAmount: string;
  couponCode: string | null;
  couponDiscount: string;
  pointsRedeemed: number;
  pointsDiscount: string;
  currencyCode: string;
  selectedExtras: { name: string; price: number; perPerson: boolean }[] | null;
  startDatetime: string;
  endDatetime: string;
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  createdAt: string;
  cancelledAt: string | null;
  cancelledBy: 'CUSTOMER' | 'VENDOR' | 'ADMIN' | 'SYSTEM' | null;
  refundDecisionAt: string | null;
  refundDecisionActor: 'CUSTOMER' | 'VENDOR' | 'ADMIN' | 'SYSTEM' | null;
  refundDecisionNote: string | null;
  customer: { id: string; fullName: string; email: string; phone: string | null };
  activity: { titleEn: string; bookingType: 'HOURLY' | 'DAILY'; durationValue: number | null; cancellationPolicy: string | null; country: { currencyCode: string } };
  vendor: { businessNameEn: string };
  payment: { id: string; amount: string; status: string; method: string; paidAt: string | null; gatewayTxnId: string | null; refundAmount: string | null; refundedAt: string | null } | null;
}

interface BookingsResponse {
  data: Booking[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const statusConfig: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  PENDING: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', icon: Clock },
  CONFIRMED: { bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', icon: CheckCircle },
  COMPLETED: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', icon: CheckCheck },
  CANCELLED: { bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400', icon: XCircle },
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

export default function AdminBookingsPage() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput);
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [decisionModal, setDecisionModal] = useState<{ booking: Booking; action: 'APPROVE' | 'REJECT' } | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const decisionMutation = useMutation({
    mutationFn: async ({ bookingId, action, amount, note }: {
      bookingId: string;
      action: 'APPROVE' | 'REJECT';
      amount?: number;
      note?: string;
    }) => {
      await api.post(`/bookings/${bookingId}/refund-decision`, { action, amount, note });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'bookings'] });
      toast(variables.action === 'APPROVE' ? 'Refund decision recorded' : 'Refund request rejected');
      setDecisionModal(null);
      setAmountInput('');
      setNoteInput('');
    },
    onError: (err) => { toast(getApiError(err, 'Failed to record decision'), 'error'); },
  });

  const openApprove = (b: Booking) => {
    const paid = b.payment ? Number(b.payment.amount) : Number(b.totalPrice);
    const suggested = b.payment?.refundAmount ? Number(b.payment.refundAmount) : paid;
    setDecisionModal({ booking: b, action: 'APPROVE' });
    setAmountInput(String(suggested));
    setNoteInput('');
  };

  const openReject = (b: Booking) => {
    setDecisionModal({ booking: b, action: 'REJECT' });
    setAmountInput('');
    setNoteInput('');
  };

  const confirmDecision = () => {
    if (!decisionModal) return;
    const paid = decisionModal.booking.payment ? Number(decisionModal.booking.payment.amount) : Number(decisionModal.booking.totalPrice);
    // Defence-in-depth: sanitize client-side before POST even though
    // the backend SanitizePipe handles the authoritative scrub.
    const cleanNote = noteInput.trim() ? sanitize(noteInput.trim()).slice(0, 1000) : undefined;
    if (decisionModal.action === 'APPROVE') {
      const amt = Number(amountInput);
      if (!Number.isFinite(amt) || amt < 0) { toast('Enter a valid non-negative amount', 'error'); return; }
      if (amt > paid) { toast(`Amount cannot exceed the paid amount (${paid})`, 'error'); return; }
      decisionMutation.mutate({ bookingId: decisionModal.booking.id, action: 'APPROVE', amount: amt, note: cleanNote });
    } else {
      decisionMutation.mutate({ bookingId: decisionModal.booking.id, action: 'REJECT', note: cleanNote });
    }
  };

  const { data, isLoading } = useQuery<BookingsResponse>({
    queryKey: ['admin', 'bookings', page, search, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      const { data } = await api.get(`/admin/bookings?${params}`);
      return data;
    },
    staleTime: 30_000,
  });

  const handleExport = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/export/bookings');
      if (!data || data.length === 0) {
        toast('No bookings to export', 'error');
        return;
      }
      // Client-side status filter so the export respects the current view.
      // Admin bookings are read-only — this is the only write they get.
      const rows = (statusFilter ? data.filter((b: any) => b.status === statusFilter) : data).map((b: any) => ({
        Ref: b.ref,
        Customer: b.customer?.fullName ?? '',
        Email: b.customer?.email ?? '',
        BookingPhone: b.bookingPhone ?? '',
        Activity: b.activity?.titleEn ?? '',
        Vendor: b.vendor?.businessNameEn ?? '',
        StartDate: new Date(b.startDatetime).toISOString().slice(0, 16).replace('T', ' '),
        EndDate: new Date(b.endDatetime).toISOString().slice(0, 16).replace('T', ' '),
        Guests: b.guests,
        Total: Number(b.totalPrice).toFixed(2),
        Currency: b.currencyCode ?? b.activity?.country?.currencyCode ?? '',
        ServiceFee: Number(b.serviceFee).toFixed(2),
        Commission: Number(b.commissionAmount).toFixed(2),
        CouponCode: b.couponCode ?? '',
        CouponDiscount: Number(b.couponDiscount ?? 0).toFixed(2),
        WanasaPointsUsed: Number(b.pointsRedeemed ?? 0),
        WanasaPointsValue: Number(b.pointsDiscount ?? 0).toFixed(2),
        NominalTotal: (Number(b.totalPrice) + Number(b.couponDiscount ?? 0)).toFixed(2),
        CashCollected: Number(b.payment?.amount ?? 0).toFixed(2),
        Status: b.status,
        PaymentStatus: b.payment?.status ?? 'NONE',
        PaymentMethod: b.payment?.method ?? '',
        PaidAt: b.payment?.paidAt ? new Date(b.payment.paidAt).toISOString().slice(0, 10) : '',
      }));
      if (rows.length === 0) {
        toast('No bookings match the current filter', 'error');
        return;
      }
      const headers = Object.keys(rows[0]);
      const csv = [
        headers.join(','),
        ...rows.map((r: Record<string, unknown>) =>
          headers.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')
        ),
      ].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const suffix = statusFilter ? `-${statusFilter.toLowerCase()}` : '';
      a.download = `bookings${suffix}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Bookings exported');
    } catch {
      toast('Failed to export bookings', 'error');
    }
  }, [statusFilter, toast]);

  return (
    <AdminLayout title="Bookings" subtitle="View and manage all platform bookings">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex flex-1 items-center gap-3 w-full">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-slate-500" />
            <input
              type="text"
              placeholder="Search by ref or customer name..."
              value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); setPage(1); }}
              className="w-full ps-10 pe-4 py-2.5 bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
          </div>
          <CustomSelect
            options={[
              { value: 'PENDING', label: 'Pending' },
              { value: 'CONFIRMED', label: 'Confirmed' },
              { value: 'COMPLETED', label: 'Completed' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
            value={statusFilter}
            onChange={(val) => { setStatusFilter(val); setPage(1); }}
            placeholder="All Statuses"
          />
        </div>
        <button
          type="button"
          onClick={handleExport}
          title={statusFilter ? `Export ${statusFilter.toLowerCase()} bookings` : 'Export all bookings'}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-300 text-sm font-medium rounded-xl transition-all whitespace-nowrap"
        >
          <Download className="h-4 w-4" /> Export{statusFilter ? ` ${statusFilter.charAt(0) + statusFilter.slice(1).toLowerCase()}` : ''}
        </button>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : (
        <div className="rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-800">
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Ref</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Customer</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Activity</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Date</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Total</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Payment</th>
                  <th className="text-end px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                {data?.data.length === 0 && (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400 dark:text-slate-500">No bookings found.</td></tr>
                )}
                {data?.data.map((booking) => {
                  const badge = statusConfig[booking.status] ?? statusConfig.PENDING;
                  const BadgeIcon = badge.icon;
                  const isExpanded = expandedId === booking.id;
                  const currency = booking.currencyCode || booking.activity.country?.currencyCode || 'QAR';
                  return (
                    <React.Fragment key={booking.id}>
                      <tr
                        className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer"
                        onClick={() => setExpandedId(isExpanded ? null : booking.id)}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                            <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-1 rounded-md">{booking.ref}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <p className="font-medium text-gray-900 dark:text-white">{booking.customer.fullName}</p>
                          <p className="text-xs text-gray-400 dark:text-slate-500">{booking.guests} guest(s)</p>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-gray-700 dark:text-slate-300 wrap-break-word max-w-[240px]">{booking.activity.titleEn}</p>
                          <p className="text-xs text-gray-400 dark:text-slate-500 wrap-break-word max-w-[240px]">{booking.vendor.businessNameEn}</p>
                        </td>
                        <td className="px-6 py-4 text-gray-500 dark:text-slate-400 text-xs">
                          <p>{new Date(booking.startDatetime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                          {(() => {
                            // For HOURLY bookings, show the actual booked
                            // time range and duration — with flex-length
                            // bookings the start date alone is not enough.
                            if (booking.activity?.bookingType !== 'HOURLY') return null;
                            const start = new Date(booking.startDatetime);
                            const end = new Date(booking.endDatetime);
                            const hours = Math.round((end.getTime() - start.getTime()) / (60 * 60 * 1000));
                            const opts = { hour: '2-digit' as const, minute: '2-digit' as const, hour12: false, timeZone: 'UTC' };
                            return (
                              <p className="mt-0.5 tabular-nums">
                                {start.toLocaleTimeString('en-US', opts)} — {end.toLocaleTimeString('en-US', opts)} · {hours}h
                              </p>
                            );
                          })()}
                        </td>
                        <td className="px-6 py-4">
                          {(() => {
                            // Nominal (gross) activity value — add coupon +
                            // Wanasa points back to totalPrice so a fully
                            // points-funded booking doesn't read as 0.
                            const nominal = Number(booking.totalPrice) + Number(booking.couponDiscount || 0);
                            const pts = Number(booking.pointsRedeemed || 0);
                            return (
                              <div className="flex flex-col gap-0.5">
                                <span className="text-gray-900 dark:text-white font-medium">
                                  {nominal.toLocaleString()} {currency}
                                </span>
                                {pts > 0 && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-600 dark:text-purple-400">
                                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                                    {pts} pts used
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-6 py-4">
                          {booking.payment ? (
                            <div className="flex flex-col gap-1">
                              {booking.payment.method === 'WANASA_POINTS' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 w-fit">
                                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                                  Wanasa
                                </span>
                              )}
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium w-fit ${
                                booking.payment.status === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                                booking.payment.status === 'REFUNDED' ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400' :
                                booking.payment.status === 'FAILED' ? 'bg-red-500/10 text-red-600 dark:text-red-400' :
                                'bg-gray-500/10 text-gray-500 dark:text-slate-400'
                              }`}>
                                <CreditCard className="h-3 w-3" />
                                {booking.payment.status === 'SUCCESS' ? 'Paid' :
                                 booking.payment.status === 'REFUNDED' ? 'Refund' :
                                 booking.payment.status === 'FAILED' ? 'Failed' : 'Pending'}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400 dark:text-slate-500">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-end">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${badge.bg} ${badge.text}`}>
                            <BadgeIcon className="h-3.5 w-3.5" />{booking.status}
                          </span>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-gray-50/40 dark:bg-slate-800/20">
                          <td colSpan={7} className="px-6 py-5">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 text-sm">
                              {/* ── Customer ── */}
                              <div className="space-y-1.5">
                                <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Customer</p>
                                <p className="font-medium text-gray-900 dark:text-white leading-tight">{booking.customer.fullName}</p>
                                <p className="text-xs text-gray-500 dark:text-slate-400 break-all">{booking.customer.email}</p>
                                {booking.bookingPhone && (
                                  <p className="text-xs text-gray-500 dark:text-slate-400">
                                    Booking phone:{' '}
                                    <a
                                      href={`tel:${booking.bookingPhone}`}
                                      className="text-blue-600 dark:text-blue-400 hover:underline tabular-nums"
                                    >
                                      {booking.bookingPhone}
                                    </a>
                                  </p>
                                )}
                              </div>

                              {/* ── Dates ── */}
                              <div className="space-y-1.5">
                                <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Dates</p>
                                <p className="font-medium text-gray-900 dark:text-white leading-tight">
                                  {new Date(booking.startDatetime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-slate-400">
                                  → {new Date(booking.endDatetime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </p>
                              </div>

                              {/* ── Price Breakdown ── */}
                              <div className="space-y-1">
                                <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">Price Breakdown</p>
                                {(() => {
                                  const nominal = Number(booking.totalPrice) + Number(booking.couponDiscount || 0);
                                  const cash = booking.payment ? Number(booking.payment.amount) : 0;
                                  const pts = Number(booking.pointsRedeemed || 0);
                                  return (
                                    <>
                                      <div className="flex justify-between text-xs">
                                        <span className="text-gray-500 dark:text-slate-400">Activity value</span>
                                        <span className="font-medium text-gray-900 dark:text-white">{nominal.toLocaleString()} {currency}</span>
                                      </div>
                                      <div className="flex justify-between text-xs">
                                        <span className="text-gray-500 dark:text-slate-400">Service fee</span>
                                        <span className="text-gray-600 dark:text-slate-300">{Number(booking.serviceFee).toLocaleString()} {currency}</span>
                                      </div>
                                      {Number(booking.couponDiscount) > 0 && (
                                        <div className="flex justify-between text-xs">
                                          <span className="text-emerald-600 dark:text-emerald-400">Coupon {booking.couponCode}</span>
                                          <span className="text-emerald-600 dark:text-emerald-400">-{Number(booking.couponDiscount).toLocaleString()} {currency}</span>
                                        </div>
                                      )}
                                      {pts > 0 && (
                                        <div className="flex justify-between text-xs">
                                          <span className="text-purple-600 dark:text-purple-400 inline-flex items-center gap-1">
                                            <Sparkles className="h-3 w-3" aria-hidden="true" />
                                            Wanasa points ({pts})
                                          </span>
                                          <span className="text-purple-600 dark:text-purple-400">-{Number(booking.pointsDiscount).toLocaleString()} {currency}</span>
                                        </div>
                                      )}
                                      <div className="flex justify-between text-xs pt-1 border-t border-gray-200 dark:border-slate-700/50 mt-1">
                                        <span className="text-gray-700 dark:text-slate-300 font-semibold">Cash collected</span>
                                        <span className="text-gray-900 dark:text-white font-semibold">{cash.toLocaleString()} {currency}</span>
                                      </div>
                                      {Number(booking.commissionAmount) > 0 && (
                                        <div className="flex justify-between text-xs">
                                          <span className="text-gray-500 dark:text-slate-400">Commission {booking.commissionPct}%</span>
                                          <span className="text-gray-600 dark:text-slate-300">{Number(booking.commissionAmount).toLocaleString()} {currency}</span>
                                        </div>
                                      )}
                                      <div className="flex justify-between text-xs">
                                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Vendor net</span>
                                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{(Number(booking.totalPrice) - Number(booking.commissionAmount)).toLocaleString()} {currency}</span>
                                      </div>
                                    </>
                                  );
                                })()}
                              </div>

                              {/* ── Payment ── */}
                              <div className="space-y-1.5">
                                <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Payment</p>
                                {booking.payment ? (
                                  <>
                                    <p className="font-medium text-gray-900 dark:text-white leading-tight">
                                      {booking.payment.status === 'SUCCESS' ? 'Paid' : booking.payment.status === 'REFUNDED' ? 'Refund pending' : booking.payment.status}
                                      {booking.payment.method && booking.payment.method !== 'PENDING' ? ` · ${booking.payment.method}` : ''}
                                    </p>
                                    {booking.payment.paidAt && (
                                      <p className="text-xs text-gray-500 dark:text-slate-400">
                                        {new Date(booking.payment.paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                      </p>
                                    )}
                                    {booking.payment.gatewayTxnId && (
                                      <p className="text-[11px] text-gray-400 dark:text-slate-500 font-mono truncate">TXN: {booking.payment.gatewayTxnId}</p>
                                    )}
                                    {booking.payment.refundAmount && (
                                      <p className="text-xs text-purple-600 dark:text-purple-400">Refund: {Number(booking.payment.refundAmount).toLocaleString()} {currency}</p>
                                    )}
                                  </>
                                ) : (
                                  <p className="text-xs text-gray-400 dark:text-slate-500 italic">No payment</p>
                                )}
                              </div>
                            </div>

                            {/* ── Add-ons row (full-width below the grid) ── */}
                            {booking.selectedExtras && booking.selectedExtras.length > 0 && (
                              <div className="mt-4 pt-4 border-t border-gray-200/60 dark:border-slate-700/40">
                                <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2">Add-ons Selected</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {booking.selectedExtras.map((svc, i) => (
                                    <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded-lg text-xs font-medium">
                                      <Tag className="h-3 w-3" />
                                      {svc.name} +{svc.price} {currency}{svc.perPerson ? '/person' : ''}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* ── REFUND_PENDING banner + action buttons ── */}
                            {booking.payment?.status === 'REFUND_PENDING' && (
                              <div className="mt-4 pt-4 border-t border-amber-200/60 dark:border-amber-700/40">
                                <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 p-4 flex flex-wrap items-start justify-between gap-3">
                                  <div className="flex items-start gap-3 min-w-0 flex-1">
                                    <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                    <div>
                                      <p className="text-sm font-semibold text-amber-900 dark:text-amber-300">Awaiting refund decision</p>
                                      <p className="text-xs text-amber-800 dark:text-amber-400 mt-0.5">
                                        Customer cancelled this paid booking. The vendor needs to record a refund decision — or you can override as admin.
                                        {booking.payment.refundAmount && (
                                          <> System suggested: <span className="font-semibold">{Number(booking.payment.refundAmount).toLocaleString()} {currency}</span> (policy: {booking.activity.cancellationPolicy ?? 'FREE_CANCELLATION'}).</>
                                        )}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      onClick={() => openReject(booking)}
                                      disabled={decisionMutation.isPending}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 border border-red-200 dark:border-red-800/50"
                                    >
                                      <XCircle className="h-3.5 w-3.5" /> No Refund
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openApprove(booking)}
                                      disabled={decisionMutation.isPending}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5" /> Record Refund
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* ── Refund decision already recorded ── */}
                            {booking.refundDecisionAt && (booking.payment?.status === 'REFUNDED' || booking.payment?.status === 'REJECTED') && (
                              <div className="mt-4 pt-4 border-t border-gray-200/60 dark:border-slate-700/40">
                                <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2">Refund Decision</p>
                                <div className="space-y-1 text-xs">
                                  <p className="text-gray-700 dark:text-slate-300">
                                    <span className="text-gray-500 dark:text-slate-400">Outcome:</span>{' '}
                                    {booking.payment.status === 'REFUNDED' ? (
                                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">Refunded {Number(booking.payment.refundAmount ?? 0).toLocaleString()} {currency}</span>
                                    ) : (
                                      <span className="font-semibold text-red-600 dark:text-red-400">Rejected (no refund)</span>
                                    )}
                                  </p>
                                  <p className="text-gray-500 dark:text-slate-400">
                                    By {booking.refundDecisionActor ?? '—'} on {booking.refundDecisionAt ? new Date(booking.refundDecisionAt).toLocaleString() : '—'}
                                  </p>
                                  {booking.refundDecisionNote && (
                                    <p className="text-gray-600 dark:text-slate-300 mt-1 italic">&ldquo;{booking.refundDecisionNote}&rdquo;</p>
                                  )}
                                </div>
                              </div>
                            )}
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

      {/* Refund decision modal (admin) */}
      {decisionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                {/* Match the icon-wrapper shape used by the payout revert/
                    mark-unpaid modals so every destructive admin modal reads
                    visually identical (rounded-xl square, not circle). */}
                <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${decisionModal.action === 'APPROVE' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'}`}>
                  {decisionModal.action === 'APPROVE' ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> : <XCircle className="h-5 w-5" aria-hidden="true" />}
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {decisionModal.action === 'APPROVE' ? 'Record Refund' : 'Reject Refund Request'}
                </h3>
              </div>
              <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
                Booking <span className="font-mono font-semibold">{decisionModal.booking.ref}</span> for{' '}
                <span className="font-semibold">{decisionModal.booking.customer.fullName}</span>.
              </p>
              {decisionModal.action === 'APPROVE' && (
                <div className="mb-4">
                  <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
                    Refund Amount ({decisionModal.booking.currencyCode || 'QAR'})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={decisionModal.booking.payment ? Number(decisionModal.booking.payment.amount) : Number(decisionModal.booking.totalPrice)}
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                  <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1">
                    Maximum: {decisionModal.booking.payment ? Number(decisionModal.booking.payment.amount) : Number(decisionModal.booking.totalPrice)}
                  </p>
                </div>
              )}
              <div className="mb-5">
                <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
                  Note to customer <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value.slice(0, 1000))}
                  rows={3}
                  placeholder={decisionModal.action === 'APPROVE' ? 'Details about the refund...' : 'Reason for rejection...'}
                  className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 resize-none"
                />
                <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">{noteInput.length}/1000</p>
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setDecisionModal(null); setAmountInput(''); setNoteInput(''); }}
                  disabled={decisionMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDecision}
                  disabled={decisionMutation.isPending}
                  className={`px-4 py-2 text-sm font-medium text-white rounded-xl disabled:opacity-50 ${decisionModal.action === 'APPROVE' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
                >
                  {decisionMutation.isPending ? 'Saving...' : decisionModal.action === 'APPROVE' ? 'Confirm Refund' : 'Confirm Rejection'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
