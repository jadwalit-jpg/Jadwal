'use client';

/**
 * Admin → Featured order.
 *
 * Every featured listing in the order the homepage "Featured" row shows it.
 * The admin moves rows (drag handle with mouse, touch or keyboard; Up / Down
 * buttons), removes a listing from Featured (same as the star on Activities,
 * takes effect at once), and saves the whole order in ONE request:
 * PUT /admin/activities/featured/order { ids }. The server refuses the save
 * with 409 if the featured set changed since the page loaded.
 *
 * Only the order of the homepage row changes; nothing here touches customer
 * pages, routes or slugs. Admin panel text is English, like every other
 * admin page.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, ChevronLeft, GripVertical, RotateCcw, Star, X } from 'lucide-react';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { useToast } from '@/components/toast';
import AdminLayout from '../../_components/admin-layout';

export type FeaturedHiddenReason = 'INACTIVE' | 'VENDOR_NOT_ACTIVE' | 'VENDOR_DELETED';

export interface FeaturedActivity {
  id: string;
  titleEn: string;
  titleAr: string;
  slug: string;
  coverImage: string | null;
  status: string;
  featuredOrder: number | null;
  vendor: { id: string; businessNameEn: string; status: string; deleted: boolean };
  city: { nameEn: string };
  country: { id: string; nameEn: string };
  showsOnHomepage: boolean;
  hiddenReason: FeaturedHiddenReason | null;
}

interface FeaturedResponse {
  data: FeaturedActivity[];
  total: number;
  homepageLimit: number;
}

/** How many listings the homepage row shows; mirrors HOMEPAGE_FEATURED_LIMIT on the API. */
export const HOMEPAGE_FEATURED_LIMIT = 20;

export const SAVED_TOAST = 'Order saved. The homepage shows the new order within a few minutes.';
export const UNSAVED_PROMPT = 'You have unsaved changes to the featured order. Leave without saving?';

export const HIDDEN_REASON_TEXT: Record<FeaturedHiddenReason, string> = {
  INACTIVE: 'The listing is not active',
  VENDOR_NOT_ACTIVE: 'The vendor is not active',
  VENDOR_DELETED: 'The vendor was deleted',
};

/** Same ids in the same order? (Pure: the Save button and the leave guard both use it.) */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Move the item at `from` to `to` (both indexes), clamped to the list. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return [...items];
  const target = Math.max(0, Math.min(items.length - 1, to));
  if (target === from) return [...items];
  return arrayMove([...items], from, target);
}

const btnIcon =
  'inline-flex items-center justify-center h-11 w-11 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors';

function SortableRow({
  activity,
  index,
  count,
  onMove,
  onRemove,
  removing,
}: {
  activity: FeaturedActivity;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: (activity: FeaturedActivity) => void;
  removing: boolean;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: activity.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const position = index + 1;
  const overLimit = position > HOMEPAGE_FEATURED_LIMIT;

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid={`featured-row-${activity.id}`}
      data-position={position}
      className={`flex items-center gap-3 sm:gap-4 rounded-2xl border bg-white dark:bg-slate-900 px-3 py-3 sm:px-4 ${
        isDragging ? 'border-blue-400 shadow-lg relative z-10' : 'border-gray-200 dark:border-slate-800'
      } ${!activity.showsOnHomepage || overLimit ? 'opacity-80' : ''}`}
    >
      {/* Drag handle: the only part that starts a drag, so the page still scrolls on a phone. */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag to move "${activity.titleEn}" (position ${position} of ${count})`}
        className={`${btnIcon} cursor-grab active:cursor-grabbing touch-none`}
      >
        <GripVertical className="h-5 w-5" aria-hidden="true" />
      </button>

      <span
        aria-label={`Position ${position}`}
        className={`shrink-0 w-8 text-center text-base font-bold tabular-nums ${overLimit ? 'text-gray-400 dark:text-slate-500' : 'text-gray-900 dark:text-white'}`}
      >
        {position}
      </span>

      <div className="shrink-0 h-14 w-20 rounded-lg overflow-hidden bg-gray-100 dark:bg-slate-800">
        {activity.coverImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={activity.coverImage} alt="" width={80} height={56} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full grid place-items-center text-[10px] text-gray-400 dark:text-slate-500">No photo</div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-semibold text-gray-900 dark:text-white leading-tight truncate">{activity.titleEn}</p>
        <p dir="rtl" className="text-sm text-gray-500 dark:text-slate-400 truncate text-start">{activity.titleAr}</p>
        <p className="text-xs text-gray-500 dark:text-slate-400 truncate">
          {activity.vendor.businessNameEn} · {activity.city.nameEn}, {activity.country.nameEn}
        </p>
        {!activity.showsOnHomepage && activity.hiddenReason && (
          <p className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-medium rounded-full bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 px-2 py-0.5">
            <span>Not shown on homepage</span>
            <span className="font-normal text-gray-500 dark:text-slate-400">· {HIDDEN_REASON_TEXT[activity.hiddenReason]}</span>
          </p>
        )}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <button type="button" onClick={() => onMove(index, index - 1)} disabled={index === 0} aria-label={`Move "${activity.titleEn}" up`} className={btnIcon}>
          <ArrowUp className="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => onMove(index, index + 1)} disabled={index === count - 1} aria-label={`Move "${activity.titleEn}" down`} className={btnIcon}>
          <ArrowDown className="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onRemove(activity)}
          disabled={removing}
          aria-label={`Remove "${activity.titleEn}" from featured`}
          className={`${btnIcon} text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40`}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

export default function AdminFeaturedOrderPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery<FeaturedResponse>({
    queryKey: ['admin', 'featured-order'],
    queryFn: async () => {
      const { data } = await api.get('/admin/activities/featured');
      return data;
    },
    // Never refetch behind the admin's back: a silent refetch would overwrite
    // moves that are not saved yet. "Reload" below refetches on purpose.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  // The order on screen, seeded from the server list and reseeded only when a
  // new server list arrives (initial load or an explicit Reload). Adjusted
  // during render, React's pattern for state that follows a changed input,
  // so no effect runs behind the admin's back.
  const [state, setState] = useState<{ source: FeaturedResponse | undefined; items: FeaturedActivity[]; loadedIds: string[] }>({
    source: undefined, items: [], loadedIds: [],
  });
  if (data !== state.source) {
    setState({ source: data, items: data?.data ?? [], loadedIds: data?.data.map((a) => a.id) ?? [] });
  }
  const { items, loadedIds } = state;
  const setItems = useCallback((update: (prev: FeaturedActivity[]) => FeaturedActivity[]) => {
    setState((prev) => ({ ...prev, items: update(prev.items) }));
  }, []);
  const setLoadedIds = useCallback((update: (prev: string[]) => string[]) => {
    setState((prev) => ({ ...prev, loadedIds: update(prev.loadedIds) }));
  }, []);

  const currentIds = useMemo(() => items.map((a) => a.id), [items]);
  const dirty = !sameOrder(currentIds, loadedIds);

  // Leave guard: reload / close tab, and in-app links (the App Router has no
  // route-change event, so clicks on links are checked in the capture phase).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    const onClickCapture = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || e.defaultPrevented) return;
      if (!window.confirm(UNSAVED_PROMPT)) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClickCapture, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClickCapture, true);
    };
  }, [dirty]);

  const move = useCallback((from: number, to: number) => {
    setItems((prev) => moveItem(prev, from, to));
  }, [setItems]);

  const sensors = useSensors(
    // Mouse and touch. The activation distance keeps a tap on the handle from
    // starting a drag, and the handle alone has the listeners, so the list
    // still scrolls when a phone user swipes over a row.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Space picks the row up, arrows move it, space drops it, Escape cancels.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const from = prev.findIndex((a) => a.id === active.id);
      const to = prev.findIndex((a) => a.id === over.id);
      return from < 0 || to < 0 ? prev : arrayMove(prev, from, to);
    });
  }, [setItems]);

  const saveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data } = await api.put('/admin/activities/featured/order', { ids });
      return data as { updated: number };
    },
    onSuccess: (_res, ids) => {
      setLoadedIds(() => ids);
      toast(SAVED_TOAST);
      // The homepage reads the catalog; the admin Activities list shows the star.
      queryClient.invalidateQueries({ queryKey: ['admin', 'activities'] });
    },
    onError: (err: unknown) => {
      toast(getApiError(err, 'Could not save the order.'), 'error');
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (activity: FeaturedActivity) => {
      const { data } = await api.patch(`/admin/activities/${activity.id}/feature`);
      return data as { id: string; titleEn: string; isFeatured: boolean };
    },
    onSuccess: (res, activity) => {
      if (res.isFeatured) {
        // The listing was already unfeatured by someone else and our toggle featured it again: undo that, then tell the admin.
        toast(`"${activity.titleEn}" was already removed by someone else. Reload to see the current list.`, 'error');
        return;
      }
      // Drop the row on screen and from the loaded baseline, keeping every unsaved move.
      setItems((prev) => prev.filter((a) => a.id !== activity.id));
      setLoadedIds((prev) => prev.filter((id) => id !== activity.id));
      toast(`"${activity.titleEn}" removed from featured`);
      queryClient.invalidateQueries({ queryKey: ['admin', 'activities'] });
    },
    onError: (err: unknown) => {
      toast(getApiError(err, 'Could not remove the listing from featured.'), 'error');
    },
  });

  const onRemove = useCallback((activity: FeaturedActivity) => {
    if (!window.confirm(`Remove "${activity.titleEn}" from Featured? It leaves the homepage row right away; your unsaved moves stay on screen.`)) return;
    removeMutation.mutate(activity);
  }, [removeMutation]);

  const reload = useCallback(() => {
    if (dirty && !window.confirm('Reload the list and lose your unsaved moves?')) return;
    refetch();
  }, [dirty, refetch]);

  const ids = currentIds;
  const total = items.length;

  return (
    <AdminLayout title="Featured order" subtitle="Arrange the Featured row on the homepage. Drag a row or use the arrows, then save.">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <Link href="/admin/activities" className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Activities
          </Link>
          <span className="text-sm text-gray-500 dark:text-slate-400" data-testid="featured-count">
            {total} featured · the homepage shows the first {HOMEPAGE_FEATURED_LIMIT}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={reload} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors">
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reload
          </button>
          <button
            type="button"
            onClick={() => saveMutation.mutate(ids)}
            disabled={!dirty || saveMutation.isPending}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Star className="h-4 w-4" aria-hidden="true" /> {saveMutation.isPending ? 'Saving…' : 'Save order'}
          </button>
        </div>
      </div>

      {dirty && (
        <p role="status" data-testid="unsaved-banner" className="mb-4 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl px-4 py-2.5">
          Unsaved changes. The homepage keeps the old order until you save.
        </p>
      )}

      {isLoading ? (
        <ul className="space-y-3" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="h-20 rounded-2xl bg-gray-100 dark:bg-slate-800 animate-pulse" />
          ))}
        </ul>
      ) : isError ? (
        <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-4 py-6 text-center text-sm text-red-700 dark:text-red-300">
          Could not load the featured list.{' '}
          <button type="button" onClick={() => refetch()} className="underline font-medium">Try again</button>
        </div>
      ) : total === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-slate-700 px-4 py-12 text-center text-sm text-gray-500 dark:text-slate-400">
          No featured listings. Star a listing on the <Link href="/admin/activities" className="underline">Activities</Link> page to add it here.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="space-y-3" aria-label="Featured listings in homepage order">
              {items.map((activity, index) => (
                <React.Fragment key={activity.id}>
                  <SortableRow
                    activity={activity}
                    index={index}
                    count={total}
                    onMove={move}
                    onRemove={onRemove}
                    removing={removeMutation.isPending}
                  />
                  {index + 1 === HOMEPAGE_FEATURED_LIMIT && total > HOMEPAGE_FEATURED_LIMIT && (
                    <li aria-hidden="false" data-testid="featured-limit-line" className="flex items-center gap-3 text-xs font-medium text-gray-500 dark:text-slate-400 py-1">
                      <span className="flex-1 border-t border-dashed border-gray-300 dark:border-slate-700" />
                      Only the first {HOMEPAGE_FEATURED_LIMIT} show on the homepage
                      <span className="flex-1 border-t border-dashed border-gray-300 dark:border-slate-700" />
                    </li>
                  )}
                </React.Fragment>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </AdminLayout>
  );
}
