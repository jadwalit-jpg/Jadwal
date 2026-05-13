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

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
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

export default function NotificationsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Hooks must run before the redirect early-return — keep order stable
  // across renders. Fetch is gated by `enabled` so it's a no-op pre-auth.
  const isCustomer = !!user && user.role === 'CUSTOMER';

  const { data: notifData, isLoading, isError } = useQuery<NotificationsResponse>({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.get('/notifications', { params: { limit: 50 } }).then(r => r.data),
    enabled: isCustomer,
    staleTime: 5_000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: () => api.delete('/notifications/clear-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
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

  // Redirect to login if not authenticated — same pattern as `/likes`,
  // `/bookings`, `/profile`. Hook calls above are already done, so we can
  // early-return here without violating rules-of-hooks.
  if (!authLoading && !user) {
    router.push('/login?callbackUrl=/notifications');
    return null;
  }
  // Logged-in but non-customer (admin/vendor) — bounce them home; the
  // notifications endpoint is customer-scoped on the API.
  if (!authLoading && user && !isCustomer) {
    router.push('/');
    return null;
  }

  const unread = notifData?.unreadCount ?? 0;
  const notifications = notifData?.data ?? [];

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
                  {unread} {unread === 1 ? 'unread' : 'unread'}
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

          {/* List */}
          {notifications.length > 0 && (
            <ul className="space-y-2">
              {notifications.map((n) => {
                const dot = TYPE_COLORS[n.type] || 'bg-slate-500';
                const clickable = !!n.link && isSafeRelativePath(n.link);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleClick(n)}
                      className={`w-full text-start flex items-start gap-3 p-4 rounded-2xl border transition-colors ${
                        n.read
                          ? 'bg-jadwal-surface border-jadwal-border-subtle hover:bg-gray-50 dark:hover:bg-slate-800/60'
                          : 'bg-blue-50/60 dark:bg-blue-500/5 border-blue-100 dark:border-blue-500/20 hover:bg-blue-50 dark:hover:bg-blue-500/10'
                      } ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <p className={`text-sm leading-snug ${n.read ? 'text-jadwal-text' : 'font-semibold text-jadwal-text'}`}>
                            {n.title}
                          </p>
                          <span className="text-xs text-jadwal-text-muted shrink-0 mt-0.5">{timeAgo(n.createdAt)}</span>
                        </div>
                        {n.message && (
                          <p className="text-sm text-jadwal-text-muted mt-1 leading-snug">{n.message}</p>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
