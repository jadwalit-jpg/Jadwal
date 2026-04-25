'use client';

import { useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Monitor, Smartphone, Tablet, Globe, Shield, Trash2, LogOut, Clock, MapPin, Wifi,
} from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/toast';

interface Session {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

/** Parse User-Agent string into a human-readable device/browser description */
function parseUserAgent(ua: string | null): { device: string; browser: string; os: string; icon: typeof Monitor } {
  if (!ua) return { device: 'Unknown Device', browser: 'Unknown', os: 'Unknown', icon: Globe };

  // Browser detection
  let browser = 'Unknown Browser';
  if (ua.includes('Edg/')) browser = 'Microsoft Edge';
  else if (ua.includes('Chrome/') && !ua.includes('Edg/')) browser = 'Chrome';
  else if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Safari/') && !ua.includes('Chrome/')) browser = 'Safari';
  else if (ua.includes('Opera') || ua.includes('OPR/')) browser = 'Opera';

  // OS detection
  let os = 'Unknown OS';
  if (ua.includes('Windows NT 10')) os = 'Windows 10/11';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS X')) os = 'macOS';
  else if (ua.includes('Linux') && !ua.includes('Android')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  // Device type + icon
  let icon = Monitor;
  let device = `${browser} on ${os}`;
  if (ua.includes('iPhone') || ua.includes('Android') && ua.includes('Mobile')) {
    icon = Smartphone;
  } else if (ua.includes('iPad') || ua.includes('Tablet')) {
    icon = Tablet;
  }

  return { device, browser, os, icon };
}

/** Format relative time (e.g., "2 hours ago", "Just now") */
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

export default function ActiveSessions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: sessions = [], isLoading } = useQuery<Session[]>({
    queryKey: ['active-sessions'],
    queryFn: () => api.get('/auth/sessions').then(r => r.data),
    staleTime: 30_000,
  });

  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) => api.delete(`/auth/sessions/${sessionId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-sessions'] });
      toast('Session revoked', 'success');
    },
    onError: () => toast('Failed to revoke session', 'error'),
  });

  const revokeAllMutation = useMutation({
    mutationFn: () => api.delete('/auth/sessions'),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['active-sessions'] });
      toast(res.data.message, 'success');
    },
    onError: () => toast('Failed to revoke sessions', 'error'),
  });

  const handleRevoke = useCallback((id: string) => revokeMutation.mutate(id), [revokeMutation]);
  const handleRevokeAll = useCallback(() => revokeAllMutation.mutate(), [revokeAllMutation]);

  const otherSessionsCount = useMemo(
    () => sessions.filter(s => !s.isCurrent).length,
    [sessions],
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-48 bg-gray-200 dark:bg-slate-700 rounded animate-pulse" />
        {[1, 2].map(i => (
          <div key={i} className="h-24 bg-gray-100 dark:bg-slate-800 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            Active Sessions
          </h3>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            {sessions.length} active session{sessions.length !== 1 ? 's' : ''} across your devices
          </p>
        </div>

        {otherSessionsCount > 0 && (
          <button
            type="button"
            onClick={handleRevokeAll}
            disabled={revokeAllMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
          >
            <LogOut className="h-3.5 w-3.5" />
            {revokeAllMutation.isPending ? 'Revoking...' : 'Revoke All Others'}
          </button>
        )}
      </div>

      {/* Sessions List */}
      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {sessions.map((session) => {
            const { device, icon: DeviceIcon } = parseUserAgent(session.userAgent);
            const isRevoking = revokeMutation.isPending && revokeMutation.variables === session.id;

            return (
              <motion.div
                key={session.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className={`relative p-4 rounded-xl border transition-all ${
                  session.isCurrent
                    ? 'border-blue-200 dark:border-blue-800/50 bg-blue-50/50 dark:bg-blue-900/10'
                    : 'border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 hover:border-gray-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Device Info */}
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`flex-shrink-0 p-2 rounded-lg ${
                      session.isCurrent
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                        : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400'
                    }`}>
                      <DeviceIcon className="h-5 w-5" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 dark:text-white text-sm truncate">
                          {device}
                        </p>
                        {session.isCurrent && (
                          <span className="flex-shrink-0 px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full">
                            This device
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5">
                        {session.ipAddress && (
                          <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-slate-500">
                            <Wifi className="h-3 w-3" />
                            {session.ipAddress}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-slate-500">
                          <Clock className="h-3 w-3" />
                          Last active: {timeAgo(session.lastUsedAt)}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-slate-500">
                          <MapPin className="h-3 w-3" />
                          Signed in {timeAgo(session.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Revoke Button (not for current session) */}
                  {!session.isCurrent && (
                    <button
                      type="button"
                      onClick={() => handleRevoke(session.id)}
                      disabled={isRevoking}
                      className="flex-shrink-0 p-2 text-gray-400 hover:text-red-600 dark:text-slate-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                      title="Revoke this session"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {sessions.length === 0 && (
          <div className="text-center py-8 text-gray-400 dark:text-slate-500">
            <Shield className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No active sessions found</p>
          </div>
        )}
      </div>
    </div>
  );
}
