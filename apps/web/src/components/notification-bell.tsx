'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { isSafeRelativePath } from '@/lib/utils';

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
  // SYSTEM is for platform-initiated messages (e.g. admin-revert-payout,
  // maintenance notices). Neutral slate distinguishes it from transactional
  // BOOKING_NEW (blue) at a glance.
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

export default function NotificationBell({ align = 'end' }: { align?: 'start' | 'end' }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  // Unread count — poll every 30s
  const { data: countData } = useQuery<{ unreadCount: number }>({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get('/notifications/unread-count').then(r => r.data),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  // Notifications list — only fetch when dropdown is open
  const { data: notifData } = useQuery<NotificationsResponse>({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.get('/notifications', { params: { limit: 15 } }).then(r => r.data),
    enabled: open,
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

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleNotificationClick = useCallback((notif: Notification) => {
    if (!notif.read) markReadMutation.mutate(notif.id);
    // SECURITY: never call router.push with an unvalidated string from the API.
    // notif.link comes from the backend but is user-adjacent (customer text in
    // past audit logs fed some notifications). Only accept relative in-app
    // paths. Reject: "//attacker.com", "javascript:...", "data:...",
    // "http://...", backslash-escaped, or anything with a colon. This mirrors
    // the sanitizeCallbackUrl() check the middleware uses for login redirects.
    if (notif.link && isSafeRelativePath(notif.link)) {
      router.push(notif.link);
    }
    setOpen(false);
  }, [markReadMutation, router]);

  const unread = countData?.unreadCount ?? 0;
  const notifications = notifData?.data ?? [];

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="relative p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        aria-label={`${t('notifications.title')}${unread > 0 ? ` (${unread} unread)` : ''}`}
      >
        <Bell className="h-5 w-5 text-gray-600 dark:text-slate-400" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -inset-e-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown — enter animation via CSS (dropdown-in keyframes in globals.css);
          closes instantly, standard for menus. */}
      {open && (
          <div
            className={`absolute top-full mt-2 w-80 sm:w-96 bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-2xl dark:shadow-black/40 z-50 overflow-hidden animate-[dropdown-in_0.15s_ease-out] ${align === 'start' ? 'inset-s-0' : 'inset-e-0'}`}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('notifications.title')}</h3>
              {notifications.length > 0 && (
                <div className="flex items-center gap-3">
                  {unread > 0 && (
                    <button
                      type="button"
                      onClick={() => markAllReadMutation.mutate()}
                      disabled={markAllReadMutation.isPending}
                      className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      <CheckCheck className="h-3 w-3" />
                      {t('notifications.markAllRead')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => clearAllMutation.mutate()}
                    disabled={clearAllMutation.isPending}
                    className="flex items-center gap-1 text-xs text-red-500 hover:underline cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" />
                    {t('notifications.clearAll')}
                  </button>
                </div>
              )}
            </div>

            {/* List */}
            <div className="max-h-[360px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="py-10 text-center">
                  <Bell className="h-8 w-8 text-gray-300 dark:text-slate-600 mx-auto mb-2" />
                  <p className="text-sm text-gray-400 dark:text-slate-500">{t('notifications.noNotifications')}</p>
                </div>
              ) : (
                notifications.map((notif) => (
                  <button
                    key={notif.id}
                    type="button"
                    onClick={() => handleNotificationClick(notif)}
                    className={`w-full text-start px-4 py-3 flex gap-3 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer border-b border-gray-50 dark:border-slate-800/50 last:border-0 ${
                      !notif.read ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''
                    }`}
                  >
                    {/* Dot */}
                    <div className="pt-1 shrink-0">
                      <div className={`w-2 h-2 rounded-full ${!notif.read ? (TYPE_COLORS[notif.type] || 'bg-blue-500') : 'bg-transparent'}`} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-sm truncate ${!notif.read ? 'font-semibold text-gray-900 dark:text-white' : 'font-medium text-gray-600 dark:text-slate-400'}`}>
                          {notif.title}
                        </p>
                        <span className="text-[10px] text-gray-400 dark:text-slate-500 shrink-0">{timeAgo(notif.createdAt)}</span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 line-clamp-1">{notif.message}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
    </div>
  );
}
