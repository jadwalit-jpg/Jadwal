'use client';

import React, { useState } from 'react';
import { useAuth } from '@/context/auth-context';
import { useRouter, useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/lib/api';
import { localized } from '@/lib/localize';
import { useToast } from '@/components/toast';
import { VendorSidebar } from '../../_components/vendor-sidebar';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  EyeOff,
  MapPin,
  Users,
  Calendar,
  Tag,
  Image as ImageIcon,
  Star,
  Home,
  Heart,
  DollarSign,
  X,
} from 'lucide-react';
import CustomSelect from '@/components/custom-select';
import ActivityBlocksSummary from '@/components/activity-blocks-summary';

const STATUS_VIS: Record<string, { classes: string; icon: React.ElementType }> = {
  PENDING: { classes: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: Clock },
  ACTIVE: { classes: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: CheckCircle2 },
  INACTIVE: { classes: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400', icon: EyeOff },
  BLOCKED: { classes: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: XCircle },
};

export default function VendorActivitiesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();
  const { slug } = useParams() as { slug: string };
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFullDesc, setShowFullDesc] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);

  const searchTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (val: string) => {
    setSearchInput(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setSearch(val);
      setPage(1);
    }, 300);
  };

  const { data, isLoading } = useQuery({
    queryKey: [user?.id, 'vendor-activities', page, search, filterStatus],
    queryFn: () =>
      api.get('/vendor/activities', {
        params: { page, limit: 20, search: search || undefined, status: filterStatus || undefined },
      }).then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/vendor/activities/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [user?.id, 'vendor-activities'] });
      toast(t('vendor.activities.list.toast.deleted'), 'success');
      setDeleteConfirm(null);
    },
    onError: () => {
      toast(t('vendor.activities.list.toast.deleteFailed'), 'error');
      setDeleteConfirm(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/vendor/activities/${id}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [user?.id, 'vendor-activities'] });
      toast(t('vendor.activities.list.toast.statusUpdated'), 'success');
    },
    onError: () => toast(t('vendor.activities.list.toast.statusFailed'), 'error'),
  });

  const activities = data?.data ?? [];
  const totalPages = data?.totalPages ?? 1;

  const statusLabel = (status: string) => t(`vendor.dashboard.activityStatus.${status}`, { defaultValue: status });

  const filterOptions = [
    { value: 'PENDING', label: t('vendor.dashboard.activityStatus.PENDING') },
    { value: 'ACTIVE', label: t('vendor.dashboard.activityStatus.ACTIVE') },
    { value: 'INACTIVE', label: t('vendor.dashboard.activityStatus.INACTIVE') },
    { value: 'BLOCKED', label: t('vendor.dashboard.activityStatus.BLOCKED') },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 font-outfit text-gray-900 dark:text-white">
      <VendorSidebar />

      <main className="md:ms-64 p-4 md:p-10 overflow-x-hidden">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t('vendor.activities.list.title')}</h1>
            <p className="text-gray-500 dark:text-slate-400 mt-1">{t('vendor.activities.list.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => router.push(`/vendor/${slug}/activities/new`)}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white rounded-xl font-semibold transition-all shadow-lg shadow-teal-600/20 dark:shadow-teal-900/40 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            {t('vendor.activities.list.newActivity')}
          </button>
        </div>

        <div className="flex gap-4 mb-6">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder={t('vendor.activities.list.searchPlaceholder')}
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full ps-10 pe-4 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 text-gray-900 dark:text-white placeholder:text-gray-400"
            />
          </div>
          <CustomSelect
            options={filterOptions}
            value={filterStatus}
            onChange={(val) => {
              setFilterStatus(val);
              setPage(1);
            }}
            placeholder={t('vendor.activities.list.filterAllStatuses')}
          />
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 rounded-2xl overflow-hidden">
          {isLoading ? (
            <div className="p-8 space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-14 bg-gray-100 dark:bg-slate-800 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : activities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <AlertCircle className="h-10 w-10 text-gray-300 dark:text-slate-600 mb-3" />
              <p className="text-gray-500 dark:text-slate-400 font-medium">{t('vendor.activities.list.emptyTitle')}</p>
              <p className="text-gray-400 dark:text-slate-500 text-sm mt-1">{t('vendor.activities.list.emptySubtitle')}</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 dark:border-slate-800">
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.activities.list.thTitle')}
                  </th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.activities.list.thCategory')}
                  </th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.activities.list.thPrice')}
                  </th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.activities.list.thStatus')}
                  </th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.activities.list.thBookings')}
                  </th>
                  <th className="text-end px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('vendor.activities.list.thActions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {activities.map((activity: any) => {
                  const statusCfg = STATUS_VIS[activity.status] ?? STATUS_VIS.PENDING;
                  const StatusIcon = statusCfg.icon;
                  const isExpanded = expandedId === activity.id;
                  const currency = activity.country?.currencyCode ?? 'QAR';
                  return (
                    <React.Fragment key={activity.id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : activity.id)}
                        className="border-b border-gray-50 dark:border-slate-800/50 hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer"
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <ChevronDown
                              className={`h-4 w-4 text-gray-400 dark:text-slate-500 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}
                            />
                            <div>
                              <p className="font-medium text-sm text-gray-900 dark:text-white">{localized(activity, 'title')}</p>
                              <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{localized(activity.city, 'name')}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600 dark:text-slate-300">{localized(activity.category, 'name')}</td>
                        <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">
                          {currency} {Number(activity.pricePerPerson).toFixed(0)}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${statusCfg.classes}`}>
                            <StatusIcon className="h-3 w-3" />
                            {statusLabel(activity.status)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600 dark:text-slate-300">{activity._count?.bookings ?? 0}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                            {(activity.status === 'ACTIVE' || activity.status === 'INACTIVE') && (
                              <button
                                type="button"
                                onClick={() => toggleMutation.mutate(activity.id)}
                                disabled={toggleMutation.isPending}
                                title={activity.status === 'ACTIVE' ? t('vendor.activities.list.toggleDeactivate') : t('vendor.activities.list.toggleActivate')}
                                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                                  activity.status === 'ACTIVE' ? 'bg-teal-500' : 'bg-gray-200 dark:bg-slate-700'
                                } disabled:opacity-50 cursor-pointer`}
                              >
                                <span
                                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transform transition-transform ${
                                    activity.status === 'ACTIVE'
                                      ? 'translate-x-4 rtl:-translate-x-4'
                                      : 'translate-x-0.5 rtl:-translate-x-0.5'
                                  }`}
                                />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => router.push(`/vendor/${slug}/activities/${activity.slug}`)}
                              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-slate-400 transition-colors"
                              title={t('vendor.activities.list.editTitle')}
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirm(activity.id)}
                              className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                              title={t('vendor.activities.list.deleteTitle')}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="border-b border-gray-50 dark:border-slate-800/50">
                          <td colSpan={6} className="px-6 py-0">
                            <div className="py-5 ps-8">
                              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                                <div className="col-span-2">
                                  <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
                                    {t('vendor.activities.list.descLabel')}
                                  </p>
                                  <p className={`text-sm text-gray-700 dark:text-slate-300 leading-relaxed ${showFullDesc === activity.id ? '' : 'line-clamp-2'}`}>
                                    {activity.descriptionEn || t('vendor.activities.list.noDescription')}
                                  </p>
                                  {activity.descriptionAr && (
                                    <p
                                      className={`text-sm text-gray-500 dark:text-slate-400 leading-relaxed mt-1.5 ${showFullDesc === activity.id ? '' : 'line-clamp-2'}`}
                                      dir="rtl"
                                    >
                                      {activity.descriptionAr}
                                    </p>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShowFullDesc(showFullDesc === activity.id ? null : activity.id);
                                    }}
                                    className="text-xs text-teal-600 dark:text-teal-400 font-medium mt-1 hover:underline"
                                  >
                                    {showFullDesc === activity.id ? t('vendor.activities.list.showLess') : t('vendor.activities.list.showMore')}
                                  </button>
                                </div>

                                <div>
                                  <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
                                    {t('vendor.activities.list.bookingDetails')}
                                  </p>
                                  <div className="space-y-1.5">
                                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300">
                                      <Calendar className="h-3.5 w-3.5 text-gray-400 dark:text-slate-500" />
                                      <span>
                                        {activity.bookingType === 'HOURLY'
                                          ? t('vendor.activities.list.bookingHourly')
                                          : t('vendor.activities.list.bookingDaily')}
                                      </span>
                                    </div>
                                    {activity.capacity != null && activity.capacity > 0 && (
                                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300">
                                        <Users className="h-3.5 w-3.5 text-gray-400 dark:text-slate-500" />
                                        <span>{t('vendor.activities.list.capacityGuests', { count: activity.capacity })}</span>
                                      </div>
                                    )}
                                    {activity.hasUnits && activity.unitCount > 0 && (
                                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300">
                                        <Home className="h-3.5 w-3.5 text-gray-400 dark:text-slate-500" />
                                        <span>
                                          {Number(activity.unitCount) === 1
                                            ? t('vendor.activities.list.unitsLine', {
                                                units: activity.unitCount,
                                                each: activity.unitCapacity,
                                              })
                                            : t('vendor.activities.list.unitsLinePlural', {
                                                units: activity.unitCount,
                                                each: activity.unitCapacity,
                                              })}
                                        </span>
                                      </div>
                                    )}
                                    {activity.durationValue && (
                                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300">
                                        <Clock className="h-3.5 w-3.5 text-gray-400 dark:text-slate-500" />
                                        <span>
                                          {activity.bookingType === 'HOURLY'
                                            ? t('vendor.activities.list.durationHours', { n: activity.durationValue })
                                            : t('vendor.activities.list.durationNights', { n: activity.durationValue })}
                                        </span>
                                      </div>
                                    )}
                                    {activity.checkInTime && (
                                      <p className="text-xs text-gray-400 dark:text-slate-500">
                                        {activity.bookingType === 'HOURLY'
                                          ? t('vendor.activities.list.startTime')
                                          : t('vendor.activities.list.checkIn')}
                                        : {activity.checkInTime}
                                        {activity.checkOutTime
                                          ? ` · ${
                                              activity.bookingType === 'HOURLY'
                                                ? t('vendor.activities.list.endTime')
                                                : t('vendor.activities.list.checkOut')
                                            }: ${activity.checkOutTime}`
                                          : ''}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                <div>
                                  <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
                                    {t('vendor.activities.list.blockedTitle', 'Blocked dates & times')}
                                  </p>
                                  <ActivityBlocksSummary activityId={activity.id} />
                                </div>

                                <div>
                                  <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
                                    {t('vendor.activities.list.location')}
                                  </p>
                                  <div className="flex items-start gap-2 text-sm text-gray-600 dark:text-slate-300">
                                    <MapPin className="h-3.5 w-3.5 text-gray-400 dark:text-slate-500 mt-0.5 shrink-0" />
                                    <span>{activity.locationAddress || t('vendor.activities.list.noAddress')}</span>
                                  </div>
                                </div>

                                {(activity.coverImage || activity.gallery?.length > 0) &&
                                  (() => {
                                    const allImages = [...(activity.coverImage ? [activity.coverImage] : []), ...(activity.gallery ?? [])];
                                    return (
                                      <div className="col-span-2 lg:col-span-4">
                                        <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                                          <span className="inline-flex items-center gap-1">
                                            <ImageIcon className="h-3 w-3" /> {t('vendor.activities.list.imagesCount', { count: allImages.length })}
                                          </span>
                                        </p>
                                        <div className="flex gap-2 overflow-x-auto pb-1">
                                          {allImages.slice(0, 8).map((img: string, i: number) => (
                                            <button
                                              key={i}
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setLightbox({ images: allImages, index: i });
                                              }}
                                              className="relative group shrink-0 h-20 w-28 rounded-lg overflow-hidden border-2 border-transparent hover:border-blue-400 transition-all cursor-pointer"
                                            >
                                              <img
                                                src={img}
                                                alt={`${localized(activity, 'title')} ${i + 1}`}
                                                width={112}
                                                height={80}
                                                loading="lazy"
                                                decoding="async"
                                                className="w-full h-full object-cover"
                                              />
                                              {i === 0 && activity.coverImage && (
                                                <span className="absolute bottom-0 inset-s-0 inset-e-0 text-[9px] font-bold text-center bg-blue-600/80 text-white py-0.5">
                                                  {t('vendor.activities.list.coverBadge')}
                                                </span>
                                              )}
                                            </button>
                                          ))}
                                          {allImages.length > 8 && (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setLightbox({ images: allImages, index: 8 });
                                              }}
                                              className="h-20 w-28 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-100 dark:bg-slate-800 flex items-center justify-center text-sm font-medium text-gray-500 dark:text-slate-400 shrink-0 cursor-pointer hover:border-blue-400 transition-all"
                                            >
                                              {t('vendor.activities.list.moreImages', { n: allImages.length - 8 })}
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })()}

                                <div className="col-span-2 lg:col-span-4">
                                  <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                                    {t('vendor.activities.list.pricing')}
                                  </p>
                                  <div className="flex flex-wrap items-center gap-3">
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 dark:bg-slate-800 rounded-lg text-xs font-medium text-gray-700 dark:text-slate-300">
                                      <DollarSign className="h-3 w-3" />
                                      {Number(activity.pricePerPerson).toLocaleString()} {currency}
                                      {activity.bookingType === 'DAILY'
                                        ? t('vendor.activities.list.pricePerNight')
                                        : activity.pricingModel === 'PER_UNIT'
                                          ? t('vendor.activities.list.pricePerUnit')
                                          : t('vendor.activities.list.pricePerPerson')}
                                    </span>
                                    <span className="text-xs text-gray-500 dark:text-slate-400">
                                      {t('vendor.activities.list.pricingModel', {
                                        model:
                                          activity.pricingModel === 'PER_UNIT'
                                            ? t('vendor.activities.list.pricingModelPerUnit')
                                            : t('vendor.activities.list.pricingModelPerPerson'),
                                      })}
                                    </span>
                                  </div>
                                </div>

                                {(() => {
                                  const freeExtras = activity.extraServices?.filter((s: any) => s.price === 0) ?? [];
                                  const paidExtras = activity.extraServices?.filter((s: any) => s.price > 0) ?? [];
                                  const inclusions = freeExtras.map((s: any) => s.name);
                                  return (
                                    <>
                                      {inclusions.length > 0 && (
                                        <div className="col-span-2 lg:col-span-4">
                                          <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                                            {t('vendor.activities.list.included')}
                                          </p>
                                          <div className="flex flex-wrap gap-1.5">
                                            {inclusions.map((item: string, i: number) => (
                                              <span
                                                key={i}
                                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 rounded-lg text-xs font-medium"
                                              >
                                                <Tag className="h-3 w-3" />
                                                {item}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      {paidExtras.length > 0 && (
                                        <div className="col-span-2 lg:col-span-4">
                                          <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                                            {t('vendor.activities.list.paidAddons')}
                                          </p>
                                          <div className="flex flex-wrap gap-1.5">
                                            {paidExtras.map((svc: any, i: number) => (
                                              <span
                                                key={i}
                                                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded-lg text-xs font-medium"
                                              >
                                                {svc.name}
                                                <span className="font-semibold">
                                                  +{svc.price} {currency}
                                                </span>
                                                {svc.perPerson && <span className="text-[10px] text-blue-500">{t('vendor.activities.list.perPersonShort')}</span>}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </>
                                  );
                                })()}

                                <div className="col-span-2 lg:col-span-4 flex flex-wrap items-center gap-6 pt-2 border-t border-gray-100 dark:border-slate-800">
                                  <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400">
                                    <Star className="h-3.5 w-3.5" />
                                    <span>
                                      {(activity._count?.reviews ?? 0) === 1
                                        ? t('vendor.activities.list.reviewsCountOne')
                                        : t('vendor.activities.list.reviewsCount', { count: activity._count?.reviews ?? 0 })}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400">
                                    <Calendar className="h-3.5 w-3.5" />
                                    <span>
                                      {(activity._count?.bookings ?? 0) === 1
                                        ? t('vendor.activities.list.bookingsCountOne')
                                        : t('vendor.activities.list.bookingsCount', { count: activity._count?.bookings ?? 0 })}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400">
                                    <Heart className="h-3.5 w-3.5" />
                                    <span>
                                      {(activity._count?.likes ?? 0) === 1
                                        ? t('vendor.activities.list.likesCountOne')
                                        : t('vendor.activities.list.likesCount', { count: activity._count?.likes ?? 0 })}
                                    </span>
                                  </div>
                                  {activity.activeDays?.length > 0 && (
                                    <div className="text-xs text-gray-400 dark:text-slate-500">
                                      {t('vendor.activities.list.activeDays', { days: activity.activeDays.join(', ') })}
                                    </div>
                                  )}
                                  {activity.cancellationPolicy && (
                                    <div className="text-xs text-gray-400 dark:text-slate-500">
                                      {t('vendor.activities.list.cancellation', { policy: activity.cancellationPolicy })}
                                    </div>
                                  )}
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
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-slate-800">
              <p className="text-sm text-gray-500 dark:text-slate-400">
                {t('vendor.activities.list.paginationSummary', { page, total: totalPages, count: data?.total ?? 0 })}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-2 rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-2 rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{t('vendor.activities.list.deleteModalTitle')}</h3>
              <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">{t('vendor.activities.list.deleteModalBody')}</p>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                >
                  {t('vendor.activities.list.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(deleteConfirm)}
                  disabled={deleteMutation.isPending}
                  className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-xl transition-colors disabled:opacity-50"
                >
                  {deleteMutation.isPending ? t('vendor.activities.list.deleting') : t('vendor.activities.list.delete')}
                </button>
              </div>
            </div>
          </div>
        )}
        {lightbox && (
          <div className="fixed inset-0 z-9999 flex items-center justify-center bg-black/90 backdrop-blur-sm" onClick={() => setLightbox(null)}>
            <button
              type="button"
              onClick={() => setLightbox(null)}
              className="absolute top-4 inset-e-4 z-10 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            >
              <X className="h-6 w-6" />
            </button>

            <div className="absolute top-4 inset-s-4 z-10 px-3 py-1 rounded-lg bg-white/10 text-white text-sm font-medium">
              {lightbox.index + 1} / {lightbox.images.length}
            </div>

            {lightbox.images.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox((lb) => lb && { ...lb, index: (lb.index - 1 + lb.images.length) % lb.images.length });
                }}
                className="absolute inset-s-4 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}

            <img
              src={lightbox.images[lightbox.index]}
              alt={t('vendor.activities.list.lightboxImage', { n: lightbox.index + 1 })}
              width={1600}
              height={1000}
              decoding="async"
              className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />

            {lightbox.images.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox((lb) => lb && { ...lb, index: (lb.index + 1) % lb.images.length });
                }}
                className="absolute inset-e-4 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            )}

            {lightbox.images.length > 1 && (
              <div className="absolute bottom-4 flex gap-2 overflow-x-auto max-w-[90vw] px-2">
                {lightbox.images.map((img, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLightbox((lb) => lb && { ...lb, index: i });
                    }}
                    className={`shrink-0 h-14 w-20 rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                      i === lightbox.index ? 'border-white' : 'border-white/20 opacity-60 hover:opacity-100'
                    }`}
                  >
                    <img
                      src={img}
                      alt={t('vendor.activities.list.lightboxThumb', { n: i + 1 })}
                      width={80}
                      height={56}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
