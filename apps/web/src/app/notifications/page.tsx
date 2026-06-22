'use client';

/**
 * Full-page notifications list. Powered by the same `/notifications` API
 * endpoints `<NotificationBell/>` already uses (`['notifications','list']`
 * + `['notifications','unread-count']` query keys, so the cache is shared
 * with the desktop bell — no duplicate polling, marking a notification read
 * here also updates the bell's badge instantly).
 *
 * Created so that `<NavbarBasic/>` (used on `/home-test`) can surface a
 * "Notifications" row inside its mobile hamburger menu without needing to
 * nest the bell's popover inside a fixed overlay (which would fight for
 * position + z-index against the menu panel).
 */

import { useInfiniteQuery, useMutation, useQueryClient, useQuery, type InfiniteData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bell, CheckCheck, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import { useAuth } from '@/context/auth-context';
import api from '@/lib/api';
import { isSafeRelativePath } from '@/lib/utils';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import { Skeleton } from '@/components/ui';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

interface NotificationsResponse {
  data: Notification[];
  total: number;
  unreadCount: number;
  page: number;
  totalPages: number;
}

// Same `TYPE_COLORS` map the bell uses — kept in sync visually. (Duplicated
// instead of exported from the bell to avoid coupling this page to the bell's
// internal implementation; the set is short + stable.)
const TYPE_COLORS: Record<string, string> = {
  BOOKING_NEW: 'bg-blue-500',
  BOOKING_CANCELLED: 'bg-red-500',
  BOOKING_CONFIRMED: 'bg-emerald-500',
  BOOKING_COMPLETED: 'bg-teal-500',
  PAYMENT_SUCCESS: 'bg-emerald-500',
  PAYMENT_FAILED: 'bg-red-500',
  REVIEW_RECEIVED: 'bg-amber-500',
  PAYOUT_PROCESSED: 'bg-green-500',
  COUPON_APPROVED: 'bg-emerald-500',
  COUPON_REJECTED: 'bg-red-500',
  VENDOR_APPROVED: 'bg-emerald-500',
  VENDOR_SUSPENDED: 'bg-red-500',
  ACTIVITY_APPROVED: 'bg-emerald-500',
  ACTIVITY_REJECTED: 'bg-red-500',
  PAYOUT_REQUESTED: 'bg-amber-500',
  REFUND_REQUESTED: 'bg-amber-500',
  REFUND_DECIDED: 'bg-indigo-500',
  SYSTEM: 'bg-slate-500',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function NotificationRowSkeleton() {
  return (
    <div className="flex items-start gap-3 p-4 rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle">
      <Skeleton className="w-2.5 h-2.5 rounded-full mt-2 shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

// Page size — backend caps `limit` at 50 per request (notification.controller.ts).
// 20/page keeps the initial paint small + lets users scroll/load-more for
// long histories instead of dumping 50+ rows on first render.
const PAGE_SIZE = 20;

export default function NotificationsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Hooks must run before the redirect early-return — keep order stable
  // across renders. Fetches are gated by `enabled` so they're no-ops pre-auth.
  const isCustomer = !!user && user.role === 'CUSTOMER';

  // Paginated list — `useInfiniteQuery` so "Load more" appends pages without
  // re-fetching what we already have. Same `queryKey` namespace as the bell
  // (`['notifications', ...]`) — invalidating after a mutation wipes both the
  // page's list cache *and* the bell's unread-count cache in one call.
  const {
    data: notifData,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<NotificationsResponse>({
    queryKey: ['notifications', 'list', { pageSize: PAGE_SIZE }],
    queryFn: ({ pageParam = 1 }) =>
      api
        .get('/notifications', { params: { page: pageParam, limit: PAGE_SIZE } })
        .then(r => r.data),
    enabled: isCustomer,
    staleTime: 5_000,
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });

  // Unread count — separate small query so the header re-renders the unread
  // badge without re-fetching pages. Same `queryKey` as `<NotificationBell/>`,
  // so the bell's cache stays in sync with this page (and vice-versa).
  const { data: countData } = useQuery<{ unreadCount: number }>({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get('/notifications/unread-count').then(r => r.data),
    enabled: isCustomer,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  // ── Optimistic notification mutations (infinite list) ──────────────
  // Read state + unread badge update INSTANTLY, roll back on error, reconcile
  // with the server on settle. Server stays authoritative (onSettled refetch);
  // client-only perceived state → no security surface. The unread-count key is
  // shared with <NotificationBell/>, so both surfaces stay in sync.
  const COUNT_KEY = ['notifications', 'unread-count'];
  const LIST_KEY = ['notifications', 'list', { pageSize: PAGE_SIZE }];
  const snapshotNotifs = async () => {
    // Cancel in-flight refetches so they can't clobber the optimistic value.
    await queryClient.cancelQueries({ queryKey: ['notifications'] });
    return {
      count: queryClient.getQueryData<{ unreadCount: number }>(COUNT_KEY),
      list: queryClient.getQueryData<InfiniteData<NotificationsResponse>>(LIST_KEY),
    };
  };
  const rollbackNotifs = (ctx?: { count?: { unreadCount: number }; list?: InfiniteData<NotificationsResponse> }) => {
    if (ctx?.count !== undefined) queryClient.setQueryData(COUNT_KEY, ctx.count);
    if (ctx?.list !== undefined) queryClient.setQueryData(LIST_KEY, ctx.list);
  };
  const reconcileNotifs = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const wasUnread = (list: InfiniteData<NotificationsResponse> | undefined, id: string) =>
    !!list?.pages.some((p) => p.data.some((n) => n.id === id && !n.read));
  const bumpCount = (ctx: { count?: { unreadCount: number } }, delta: number) => {
    if (ctx.count) queryClient.setQueryData(COUNT_KEY, { unreadCount: Math.max(0, ctx.count.unreadCount + delta) });
  };
  const patchPages = (mapData: (data: Notification[]) => Notification[]) =>
    queryClient.setQueryData<InfiniteData<NotificationsResponse>>(LIST_KEY, (old) =>
      old ? { ...old, pages: old.pages.map((p) => ({ ...p, data: mapData(p.data) })) } : old,
    );

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onMutate: async (id: string) => {
      const ctx = await snapshotNotifs();
      if (wasUnread(ctx.list, id)) bumpCount(ctx, -1);
      patchPages((data) => data.map((n) => (n.id === id ? { ...n, read: true } : n)));
      return ctx;
    },
    onError: (_e, _id, ctx) => rollbackNotifs(ctx),
    onSettled: reconcileNotifs,
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onMutate: async () => {
      const ctx = await snapshotNotifs();
      if (ctx.count) queryClient.setQueryData(COUNT_KEY, { unreadCount: 0 });
      patchPages((data) => data.map((n) => ({ ...n, read: true })));
      return ctx;
    },
    onError: (_e, _v, ctx) => rollbackNotifs(ctx),
    onSettled: reconcileNotifs,
  });

  const clearAllMutation = useMutation({
    mutationFn: () => api.delete('/notifications/clear-all'),
    onMutate: async () => {
      const ctx = await snapshotNotifs();
      if (ctx.count) queryClient.setQueryData(COUNT_KEY, { unreadCount: 0 });
      patchPages(() => []);
      return ctx;
    },
    onError: (_e, _v, ctx) => rollbackNotifs(ctx),
    onSettled: reconcileNotifs,
  });

  // Per-notification delete. Backend `DELETE /notifications/:id`: RATE_LIMIT_WRITE,
  // ownership enforced via WHERE (`{id, userId}` in deleteMany) so a tampered id
  // for another user is a no-op. Optimistically drop the row (+ decrement the
  // badge if it was unread); rollback on error.
  const deleteOneMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/${id}`),
    onMutate: async (id: string) => {
      const ctx = await snapshotNotifs();
      if (wasUnread(ctx.list, id)) bumpCount(ctx, -1);
      patchPages((data) => data.filter((n) => n.id !== id));
      return ctx;
    },
    onError: (_e, _id, ctx) => rollbackNotifs(ctx),
    onSettled: reconcileNotifs,
  });

  const handleClick = useCallback((notif: Notification) => {
    if (!notif.read) markReadMutation.mutate(notif.id);
    // SECURITY: same as `<NotificationBell/>` — `notif.link` comes from the
    // backend and is user-adjacent (review/booking text feeds some types).
    // Only accept relative in-app paths; reject `//attacker.com`, `javascript:`,
    // `data:`, absolute URLs, or backslash-escaped values. Mirrors the
    // sanitizeCallbackUrl() check the login redirect uses.
    if (notif.link && isSafeRelativePath(notif.link)) {
      router.push(notif.link);
    }
  }, [markReadMutation, router]);

  // Auth-redirect lives in an effect rather than inline in render — calling
  // `router.push` during render is a side-effect and re-fires every paint
  // (twice under Strict Mode), polluting browser history and causing console
  // warnings. `replace` (not `push`) so the auth-gated URL doesn't sit in
  // back-stack between the user and where they came from.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login?callbackUrl=/notifications');
    } else if (!isCustomer) {
      // Logged-in but non-customer (admin/vendor) — bounce them home; the
      // notifications endpoint is customer-scoped on the API.
      router.replace('/');
    }
  }, [authLoading, user, isCustomer, router]);

  // Don't render the page content while the effect is about to redirect —
  // avoids a flash of the auth-gated layout for non-customers.
  if (!authLoading && (!user || !isCustomer)) {
    return null;
  }

  // Flatten infinite pages into a single list for rendering. Latest unread
  // count comes from the dedicated query so it's always fresh (poll = 30 s)
  // even between page-loads.
  const unread = countData?.unreadCount ?? 0;
  const notifications = notifData?.pages.flatMap((p) => p.data) ?? [];
  const total = notifData?.pages[0]?.total ?? 0;

  return (
    <div className="min-h-screen bg-jadwal-bg flex flex-col font-outfit">
      <Navbar variant="solid" />

      <main className="flex-1 pt-24 pb-16">
        <div className="max-w-2xl mx-auto px-4 sm:px-6">
          {/* Header — title + actions. `flex-wrap` so the mark-all-read / clear
              buttons stack under the title on narrow screens instead of
              overflowing. */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div>
              <h1 className="font-display text-[26px] md:text-[34px] font-semibold tracking-[-0.8px] md:tracking-[-1px] text-jadwal-text leading-[1.15] m-0">
                {t('notifications.title')}
              </h1>
              {unread > 0 && (
                <p className="text-sm text-jadwal-text-muted mt-1">
                  {unread} unread
                </p>
              )}
            </div>
            {notifications.length > 0 && (
              <div className="flex items-center gap-3">
                {unread > 0 && (
                  <button
                    type="button"
                    onClick={() => markAllReadMutation.mutate()}
                    disabled={markAllReadMutation.isPending}
                    className="flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 cursor-pointer"
                  >
                    <CheckCheck aria-hidden="true" className="h-3.5 w-3.5" />
                    {t('notifications.markAllRead')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => clearAllMutation.mutate()}
                  disabled={clearAllMutation.isPending}
                  className="flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:underline disabled:opacity-50 cursor-pointer"
                >
                  <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                  {t('notifications.clearAll')}
                </button>
              </div>
            )}
          </div>

          {/* Loading */}
          {(isLoading || authLoading) && (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <NotificationRowSkeleton key={i} />
              ))}
            </div>
          )}

          {/* Error */}
          {isError && !isLoading && (
            <div className="rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle py-16 text-center">
              <p className="text-sm text-jadwal-text-muted">{t('common.error')}</p>
            </div>
          )}

          {/* Empty */}
          {!isLoading && !authLoading && notifications.length === 0 && !isError && (
            <div className="rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle py-16 text-center">
              <Bell aria-hidden="true" className="h-10 w-10 text-jadwal-text-muted mx-auto mb-3" />
              <p className="text-sm text-jadwal-text-muted">{t('notifications.noNotifications')}</p>
            </div>
          )}

          {/* List. Each row is a `<div>` (not a `<button>`) so the per-row
              Delete button can be a *nested* `<button>` — nested buttons in
              the DOM are invalid HTML and break a11y. The row's tap target
              is the inner clickable area; the trash icon is a sibling. */}
          {notifications.length > 0 && (
            <ul className="space-y-2">
              {notifications.map((n) => {
                const dot = TYPE_COLORS[n.type] || 'bg-slate-500';
                const clickable = !!n.link && isSafeRelativePath(n.link);
                const isDeleting = deleteOneMutation.isPending && deleteOneMutation.variables === n.id;
                return (
                  <li key={n.id}>
                    <div
                      className={`relative flex items-start gap-3 p-4 pe-12 rounded-2xl border transition-colors ${
                        n.read
                          ? 'bg-jadwal-surface border-jadwal-border-subtle hover:bg-gray-50 dark:hover:bg-slate-800/60'
                          : 'bg-blue-50/60 dark:bg-blue-500/5 border-blue-100 dark:border-blue-500/20 hover:bg-blue-50 dark:hover:bg-blue-500/10'
                      } ${isDeleting ? 'opacity-50 pointer-events-none' : ''}`}
                    >
                      {/* Clickable face — full-row tap target via the
                          `absolute inset-0` overlay button. Trash button sits
                          on top with a higher stacking context. */}
                      <button
                        type="button"
                        onClick={() => handleClick(n)}
                        className={`absolute inset-0 rounded-2xl ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
                        aria-label={clickable ? `Open: ${n.title}` : n.title}
                      />
                      <span className={`relative mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} aria-hidden="true" />
                      <div className="relative flex-1 min-w-0 pointer-events-none">
                        <div className="flex items-start justify-between gap-3">
                          <p className={`text-sm leading-snug text-start ${n.read ? 'text-jadwal-text' : 'font-semibold text-jadwal-text'}`}>
                            {n.title}
                          </p>
                          <span className="text-xs text-jadwal-text-muted shrink-0 mt-0.5">{timeAgo(n.createdAt)}</span>
                        </div>
                        {n.message && (
                          <p className="text-sm text-jadwal-text-muted mt-1 leading-snug text-start">{n.message}</p>
                        )}
                      </div>
                      {/* Per-row delete — relative-positioned so it sits over
                          the `absolute inset-0` row-button. Calls
                          `DELETE /notifications/:id` (RATE_LIMIT_WRITE,
                          ownership-via-WHERE). */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteOneMutation.mutate(n.id);
                        }}
                        disabled={isDeleting}
                        aria-label={`Delete notification: ${n.title}`}
                        className="relative -me-1 p-2 rounded-full text-jadwal-text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        <X aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Load more — only renders when the backend reports more pages.
              Backend caps page size at 50; we use 20 (see PAGE_SIZE) for
              snappier first paint. */}
          {notifications.length > 0 && hasNextPage && (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="px-5 py-2.5 rounded-full text-sm font-medium text-jadwal-text bg-jadwal-surface border border-jadwal-border-subtle hover:bg-gray-50 dark:hover:bg-slate-800/60 disabled:opacity-50 cursor-pointer transition-colors"
              >
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
          {/* End-of-list hint when we've fetched everything */}
          {notifications.length > 0 && !hasNextPage && total > PAGE_SIZE && (
            <p className="mt-6 text-center text-xs text-jadwal-text-muted">
              {`Showing all ${total}`}
            </p>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
