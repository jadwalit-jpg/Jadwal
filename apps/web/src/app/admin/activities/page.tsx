'use client';

import React, { useState, useCallback, useRef } from 'react';
import NextImage from 'next/image';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useToast } from '@/components/toast';
import AdminLayout from '../_components/admin-layout';
import {
  Search, ChevronLeft, ChevronRight, CheckCircle, Clock, Ban, Star, BookOpen,
  Pencil, Download, X, ChevronDown, MapPin, Calendar, Users, Tag, Image as ImageIcon,
  Clock3, Home, Globe, ZoomIn, PauseCircle,
} from 'lucide-react';
import CustomSelect from '@/components/custom-select';

/* ─── Types ───────────────────────────────────────────────── */

interface Activity {
  id: string;
  titleEn: string;
  titleAr: string;
  slug: string;
  descriptionEn: string;
  descriptionAr: string;
  pricePerPerson: string;
  capacity: number | null;
  locationAddress: string;
  locationLat: number;
  locationLng: number;
  coverImage: string | null;
  gallery: string[];
  bookingType: string;
  pricingModel: string;
  durationValue: number | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  hasUnits: boolean;
  unitCount: number;
  unitCapacity: number;
  activeDays: string[];
  extraServices: { name: string; nameAr?: string; price: number; perPerson?: boolean }[] | null;
  cancellationPolicy: string | null;
  categoryId: string;
  status: 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  isFeatured: boolean;
  createdAt: string;
  vendor: { businessNameEn: string; slug: string };
  country: { nameEn: string; currencyCode: string };
  category: { nameEn: string };
  city: { nameEn: string } | null;
  _count: { bookings: number; reviews: number };
}

interface ActivitiesResponse {
  data: Activity[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/* ─── Constants ───────────────────────────────────────────── */

const statusConfig: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  ACTIVE: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', icon: CheckCircle },
  PENDING: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', icon: Clock },
  // INACTIVE is a real ActivityStatus enum value (a deactivated listing). It was
  // missing here, so an INACTIVE activity made statusConfig[status] undefined and
  // `badge.icon` crashed the whole admin table render.
  INACTIVE: { bg: 'bg-gray-500/10', text: 'text-gray-600 dark:text-gray-400', icon: PauseCircle },
  BLOCKED: { bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400', icon: Ban },
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

function toCsv(data: any[]): string {
  if (data.length === 0) return '';
  const rows = data.map((a) => ({
    Title: a.titleEn, Vendor: a.vendor?.businessNameEn ?? '', Category: a.category?.nameEn ?? '',
    Country: a.country?.nameEn ?? '', Price: a.pricePerPerson, Status: a.status,
    Created: new Date(a.createdAt).toISOString().slice(0, 10),
  }));
  const headers = Object.keys(rows[0]);
  return [headers.join(','), ...rows.map((r: any) => headers.map((h) => `"${String(r[h]).replace(/"/g, '""')}"`).join(','))].join('\n');
}

/* ─── Info Row Helper ─────────────────────────────────────── */

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="h-4 w-4 text-gray-400 dark:text-slate-500 shrink-0" />
      <span className="text-gray-500 dark:text-slate-400">{label}:</span>
      <span className="text-gray-900 dark:text-white font-medium">{value}</span>
    </div>
  );
}

/* ─── Component ───────────────────────────────────────────── */

export default function AdminActivitiesPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleSearch = useCallback((val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedSearch(val); setPage(1); }, 300);
  }, []);

  const { data, isLoading } = useQuery<ActivitiesResponse>({
    queryKey: ['admin', 'activities', page, debouncedSearch, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter) params.set('status', statusFilter);
      const { data } = await api.get(`/admin/activities?${params}`);
      return data;
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ activityId, status }: { activityId: string; status: string }) => {
      await api.patch(`/admin/activities/${activityId}/status`, { status });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'activities'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-stats'] });
      toast(`Activity status changed to ${variables.status}`);
    },
    onError: () => { toast('Failed to update activity status', 'error'); },
  });

  const featureMutation = useMutation({
    mutationFn: async (activityId: string) => {
      const { data } = await api.patch(`/admin/activities/${activityId}/feature`);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'activities'] });
      toast(data.isFeatured ? `"${data.titleEn}" is now featured on homepage` : `"${data.titleEn}" removed from featured`);
    },
    onError: () => { toast('Failed to toggle featured status', 'error'); },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ activityIds, status }: { activityIds: string[]; status: string }) => {
      await api.post('/admin/bulk/activities/status', { activityIds, status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'activities'] });
      setSelected(new Set());
      toast('Bulk status update completed');
    },
    onError: () => { toast('Failed to update activities', 'error'); },
  });

  const handleExport = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/export/activities');
      const csv = toCsv(data);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `activities-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
      toast('Activities exported');
    } catch { toast('Failed to export activities', 'error'); }
  }, [toast]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  return (
    <AdminLayout title="Activities" subtitle="Manage and moderate platform activities">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex flex-1 items-center gap-3 w-full">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="absolute inset-s-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-slate-500" />
            <input
              type="text"
              placeholder="Search by activity or vendor name..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full ps-10 pe-4 py-2.5 bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
          </div>
          <CustomSelect
            options={[
              { value: 'PENDING', label: 'Pending' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'BLOCKED', label: 'Blocked' },
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
                { value: 'BLOCKED', label: 'Block All' },
              ]}
              value=""
              onChange={(val) => {
                if (val) bulkStatusMutation.mutate({ activityIds: Array.from(selected), status: val });
              }}
              placeholder={`Bulk: ${selected.size} selected`}
            />
          )}
          <button type="button" onClick={handleExport} className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-300 text-sm font-medium rounded-xl transition-all">
            <Download className="h-4 w-4" /> Export
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
                    <input
                      type="checkbox"
                      onChange={() => {
                        if (!data) return;
                        if (selected.size === data.data.length) setSelected(new Set());
                        else setSelected(new Set(data.data.map((a) => a.id)));
                      }}
                      checked={data?.data.length ? selected.size === data.data.length : false}
                      className="rounded"
                    />
                  </th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Activity</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Vendor</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Price</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Stats</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="text-end px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                {data?.data.length === 0 && (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400 dark:text-slate-500">No activities found.</td></tr>
                )}
                {data?.data.map((activity) => {
                  // Fallback guard: never crash the table if a future status value
                  // isn't in statusConfig (the INACTIVE bug). Unknown → neutral PENDING style.
                  const badge = statusConfig[activity.status] ?? statusConfig.PENDING;
                  const BadgeIcon = badge.icon;
                  const isExpanded = expandedIds.has(activity.id);
                  return (
                    <React.Fragment key={activity.id}>
                      <tr
                        onClick={() => toggleExpand(activity.id)}
                        className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(activity.id)} onChange={() => toggleSelect(activity.id)} className="rounded" />
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 dark:text-white flex items-center gap-1.5 wrap-break-word max-w-[260px]">
                                {activity.titleEn}
                                {activity.isFeatured && (
                                  <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400 shrink-0" />
                                )}
                              </p>
                              <p className="text-xs text-gray-400 dark:text-slate-500">{activity.category.nameEn} &middot; {activity.country.nameEn}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-gray-600 dark:text-slate-300">{activity.vendor.businessNameEn}</td>
                        <td className="px-6 py-4 text-gray-900 dark:text-white font-medium">
                          {Number(activity.pricePerPerson).toLocaleString()} {activity.country.currencyCode}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-slate-400">
                            <span className="inline-flex items-center gap-1"><BookOpen className="h-3.5 w-3.5" />{activity._count.bookings}</span>
                            <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5" />{activity._count.reviews}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${badge.bg} ${badge.text}`}>
                            <BadgeIcon className="h-3.5 w-3.5" />{activity.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-end" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => router.push(`/admin/activities/${activity.id}`)}
                              className="p-1.5 rounded-lg text-blue-500 hover:bg-blue-500/10 transition-all"
                              title="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <CustomSelect
                              options={[
                                { value: 'PENDING', label: 'Pending' },
                                { value: 'ACTIVE', label: 'Active' },
                                { value: 'BLOCKED', label: 'Blocked' },
                              ]}
                              value={activity.status}
                              onChange={(val) => statusMutation.mutate({ activityId: activity.id, status: val })}
                              disabled={statusMutation.isPending}
                            />
                          </div>
                        </td>
                      </tr>

                      {/* ─── Expanded Detail Panel ──────────────── */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} className="px-6 py-0">
                            <div className="py-5 border-t border-gray-100 dark:border-slate-800/40">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {/* Activity Information */}
                                <div>
                                  <h4 className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-3">Activity Information</h4>
                                  <div className="space-y-2.5">
                                    <InfoRow icon={Tag} label="Title (EN)" value={activity.titleEn} />
                                    <InfoRow icon={Tag} label="Title (AR)" value={activity.titleAr} />
                                    <InfoRow icon={Tag} label="Slug" value={activity.slug} />
                                    <InfoRow icon={Tag} label="Category" value={activity.category.nameEn} />
                                    <InfoRow icon={Globe} label="Country" value={`${activity.country.nameEn} (${activity.country.currencyCode})`} />
                                    {activity.city && <InfoRow icon={MapPin} label="City" value={activity.city.nameEn} />}
                                    <InfoRow icon={MapPin} label="Address" value={activity.locationAddress} />
                                    <InfoRow icon={Calendar} label="Created" value={new Date(activity.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} />
                                    <InfoRow icon={Tag} label="Vendor" value={activity.vendor.businessNameEn} />
                                  </div>
                                </div>

                                {/* Booking & Pricing */}
                                <div>
                                  <h4 className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-3">Booking & Pricing</h4>
                                  <div className="space-y-2.5">
                                    <InfoRow icon={Calendar} label="Type" value={activity.bookingType === 'HOURLY' ? 'Hourly' : 'Daily'} />
                                    {activity.durationValue && (
                                      <InfoRow icon={Clock3} label="Duration" value={`${activity.durationValue} ${activity.bookingType === 'HOURLY' ? 'hours' : 'nights'}`} />
                                    )}
                                    {!activity.durationValue && activity.bookingType === 'DAILY' && (
                                      <InfoRow icon={Clock3} label="Duration" value="Flexible (customer picks dates)" />
                                    )}
                                    <InfoRow icon={Tag} label="Pricing Model" value={activity.pricingModel === 'PER_UNIT' ? 'Per Unit' : 'Per Person'} />
                                    <InfoRow icon={Tag} label="Price" value={`${Number(activity.pricePerPerson).toLocaleString()} ${activity.country.currencyCode} ${activity.bookingType === 'DAILY' ? '/ night' : activity.pricingModel === 'PER_UNIT' ? '/ unit' : '/ person'}`} />
                                    {activity.capacity != null && activity.capacity > 0 && (
                                      <InfoRow icon={Users} label="Capacity" value={`${activity.capacity} guests`} />
                                    )}
                                    {activity.checkInTime && (
                                      <InfoRow
                                        icon={Clock3}
                                        label={activity.bookingType === 'HOURLY' ? 'Start Time' : 'Check-in'}
                                        value={activity.checkInTime}
                                      />
                                    )}
                                    {activity.checkOutTime && (
                                      <InfoRow
                                        icon={Clock3}
                                        label={activity.bookingType === 'HOURLY' ? 'End Time' : 'Check-out'}
                                        value={activity.checkOutTime}
                                      />
                                    )}
                                    {activity.activeDays.length > 0 && (
                                      <InfoRow icon={Calendar} label="Active Days" value={activity.activeDays.join(', ')} />
                                    )}
                                    {activity.hasUnits && activity.unitCount > 0 && (
                                      <InfoRow icon={Home} label="Units" value={`${activity.unitCount} units · ${activity.unitCapacity} guests each · ${activity.unitCount * activity.unitCapacity} total capacity`} />
                                    )}
                                  </div>
                                </div>

                                {/* Quick Stats & Media */}
                                <div>
                                  <h4 className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-3">Quick Stats</h4>
                                  <div className="grid grid-cols-2 gap-3 mb-4">
                                    <div className="p-3 rounded-xl bg-gray-50 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-800/60">
                                      <p className="text-2xl font-bold text-gray-900 dark:text-white">{activity._count.bookings}</p>
                                      <p className="text-xs text-gray-500 dark:text-slate-400">Bookings</p>
                                    </div>
                                    <div className="p-3 rounded-xl bg-gray-50 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-800/60">
                                      <p className="text-2xl font-bold text-gray-900 dark:text-white">{activity._count.reviews}</p>
                                      <p className="text-xs text-gray-500 dark:text-slate-400">Reviews</p>
                                    </div>
                                  </div>

                                  {/* Gallery Preview */}
                                  {(activity.coverImage || activity.gallery.length > 0) && (() => {
                                    const allImages = [
                                      ...(activity.coverImage ? [activity.coverImage] : []),
                                      ...activity.gallery,
                                    ];
                                    return (
                                      <div>
                                        <h4 className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-2">
                                          <span className="inline-flex items-center gap-1"><ImageIcon className="h-3.5 w-3.5" /> Media ({allImages.length})</span>
                                        </h4>
                                        <div className="flex gap-2 overflow-x-auto pb-1">
                                          {allImages.map((img, i) => (
                                            <button
                                              key={i}
                                              type="button"
                                              onClick={() => setLightbox({ images: allImages, index: i })}
                                              className="relative group shrink-0 h-16 w-24 rounded-lg overflow-hidden border-2 border-transparent hover:border-blue-400 focus:outline-none focus:border-blue-500 transition-all"
                                              aria-label={`View image ${i + 1}`}
                                            >
                                              {/* eslint-disable-next-line @next/next/no-img-element */}
                                              <img
                                                src={img}
                                                alt={i === 0 && activity.coverImage ? 'Cover' : `Gallery ${i}`}
                                                width={96}
                                                height={64}
                                                loading="lazy"
                                                decoding="async"
                                                className="h-full w-full object-cover"
                                              />
                                              {i === 0 && activity.coverImage && (
                                                <span className="absolute bottom-0 inset-s-0 inset-e-0 text-[9px] font-bold text-center bg-blue-600/80 text-white py-0.5">COVER</span>
                                              )}
                                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                                                <ZoomIn className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                              </div>
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })()}

                                  {/* Inclusions & Add-ons */}
                                  {(() => {
                                    const freeExtras = activity.extraServices?.filter(s => s.price === 0) ?? [];
                                    const paidExtras = activity.extraServices?.filter(s => s.price > 0) ?? [];
                                    const inclusions = freeExtras.map(s => s.name);
                                    return (
                                      <>
                                        {inclusions.length > 0 && (
                                          <div className="mt-3">
                                            <h4 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">Included</h4>
                                            <div className="flex flex-wrap gap-1.5">
                                              {inclusions.map((item, i) => (
                                                <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 rounded-lg text-xs font-medium">
                                                  {item}
                                                </span>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                        {paidExtras.length > 0 && (
                                          <div className="mt-3">
                                            <h4 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">Paid Add-ons</h4>
                                            <div className="flex flex-wrap gap-1.5">
                                              {paidExtras.map((svc, i) => (
                                                <span key={i} className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded-lg text-xs font-medium">
                                                  {svc.name}
                                                  <span className="font-semibold">+{svc.price} {activity.country.currencyCode}</span>
                                                  {svc.perPerson && <span className="text-[10px] text-blue-500 dark:text-blue-500">/person</span>}
                                                </span>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                      </>
                                    );
                                  })()}

                                  {/* Cancellation Policy */}
                                  {activity.cancellationPolicy && (
                                    <div className="mt-3">
                                      <h4 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-1">Cancellation Policy</h4>
                                      <p className="text-xs text-gray-600 dark:text-slate-400">{activity.cancellationPolicy}</p>
                                    </div>
                                  )}

                                  {/* Actions */}
                                  <div className="mt-4 pt-3 border-t border-gray-100 dark:border-slate-800/40">
                                    <div className="flex flex-wrap gap-2">
                                      {activity.status === 'PENDING' && (
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); statusMutation.mutate({ activityId: activity.id, status: 'ACTIVE' }); }}
                                          disabled={statusMutation.isPending}
                                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors cursor-pointer"
                                        >
                                          <CheckCircle className="h-3.5 w-3.5" /> Approve
                                        </button>
                                      )}
                                      {activity.status !== 'BLOCKED' && (
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); statusMutation.mutate({ activityId: activity.id, status: 'BLOCKED' }); }}
                                          disabled={statusMutation.isPending}
                                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800/50 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors cursor-pointer"
                                        >
                                          <Ban className="h-3.5 w-3.5" /> Block
                                        </button>
                                      )}
                                      {activity.status === 'BLOCKED' && (
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); statusMutation.mutate({ activityId: activity.id, status: 'ACTIVE' }); }}
                                          disabled={statusMutation.isPending}
                                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors cursor-pointer"
                                        >
                                          <CheckCircle className="h-3.5 w-3.5" /> Unblock
                                        </button>
                                      )}
                                      {activity.status === 'ACTIVE' && (
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); featureMutation.mutate(activity.id); }}
                                          disabled={featureMutation.isPending}
                                          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                                            activity.isFeatured
                                              ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/50 hover:bg-amber-100 dark:hover:bg-amber-900/30'
                                              : 'bg-gray-50 dark:bg-slate-800/40 text-gray-600 dark:text-slate-400 border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-800/60'
                                          }`}
                                        >
                                          <Star className={`h-3.5 w-3.5 ${activity.isFeatured ? 'fill-amber-400 text-amber-400' : ''}`} />
                                          {activity.isFeatured ? 'Unfeature' : 'Feature'}
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); router.push(`/admin/activities/${activity.id}`); }}
                                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors cursor-pointer"
                                      >
                                        <Pencil className="h-3.5 w-3.5" /> Edit
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Description Section */}
                              {(activity.descriptionEn || activity.descriptionAr) && (
                                <div className="mt-5 pt-4 border-t border-gray-100 dark:border-slate-800/40">
                                  <h4 className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-2">Description</h4>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {activity.descriptionEn && (
                                      <p className="text-xs text-gray-600 dark:text-slate-400 leading-relaxed line-clamp-4">{activity.descriptionEn}</p>
                                    )}
                                    {activity.descriptionAr && (
                                      <p className="text-xs text-gray-600 dark:text-slate-400 leading-relaxed line-clamp-4" dir="rtl">{activity.descriptionAr}</p>
                                    )}
                                  </div>
                                </div>
                              )}
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

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-9999 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image viewer"
        >
          {/* Close */}
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute top-4 inset-e-4 z-10 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Counter */}
          <div className="absolute top-4 inset-s-4 z-10 px-3 py-1 rounded-lg bg-white/10 text-white text-sm font-medium">
            {lightbox.index + 1} / {lightbox.images.length}
          </div>

          {/* Prev */}
          {lightbox.images.length > 1 && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setLightbox(lb => lb && { ...lb, index: (lb.index - 1 + lb.images.length) % lb.images.length }); }}
              className="absolute inset-s-4 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Previous image"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}

          {/* Image */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.images[lightbox.index]}
            alt={`Image ${lightbox.index + 1}`}
            width={1600}
            height={1000}
            decoding="async"
            className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
            onClick={e => e.stopPropagation()}
          />

          {/* Next */}
          {lightbox.images.length > 1 && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setLightbox(lb => lb && { ...lb, index: (lb.index + 1) % lb.images.length }); }}
              className="absolute inset-e-4 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Next image"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}

          {/* Thumbnail strip */}
          {lightbox.images.length > 1 && (
            <div className="absolute bottom-4 flex gap-2 overflow-x-auto max-w-[90vw] px-2">
              {lightbox.images.map((img, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={e => { e.stopPropagation(); setLightbox(lb => lb && { ...lb, index: i }); }}
                  className={`shrink-0 h-14 w-20 rounded-lg overflow-hidden border-2 transition-all ${i === lightbox.index ? 'border-white' : 'border-white/20 opacity-60 hover:opacity-100'}`}
                  aria-label={`Go to image ${i + 1}`}
                >
                  <NextImage
                    src={img}
                    alt=""
                    width={80}
                    height={56}
                    loading="lazy"
                    unoptimized={process.env.NODE_ENV !== 'production'}
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </AdminLayout>
  );
}
