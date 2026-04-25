'use client';

import { useState, useEffect } from 'react';
import { Bell, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/context/auth-context';
import { getPushState, subscribeToPush } from '@/lib/push-notifications';
import { useToast } from '@/components/toast';

const DISMISSED_KEY = 'jadwal_push_dismissed';

/**
 * Push notification opt-in prompt — shows a subtle banner for logged-in users
 * who haven't enabled push notifications yet.
 *
 * Rules:
 * - Only shows for authenticated users
 * - Only shows if browser supports push + VAPID key is configured
 * - Only shows if permission is 'default' (not yet asked)
 * - Dismissible for the session (sessionStorage)
 * - Never auto-requests permission — only on button click
 */
export function PushPrompt() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [show, setShow] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  useEffect(() => {
    if (!user) return;

    // Don't show if already dismissed this session
    if (sessionStorage.getItem(DISMISSED_KEY)) return;

    // Only show if permission hasn't been asked yet
    const state = getPushState();
    if (state === 'default') {
      // Delay showing the prompt so it doesn't appear immediately on page load
      const timer = setTimeout(() => setShow(true), 5000);
      return () => clearTimeout(timer);
    }
  }, [user]);

  const handleEnable = async () => {
    setSubscribing(true);
    const success = await subscribeToPush();
    setSubscribing(false);

    if (success) {
      toast(t('notifications.pushEnabled'), 'success');
      setShow(false);
    } else {
      toast(t('notifications.pushDenied'), 'error');
      sessionStorage.setItem(DISMISSED_KEY, '1');
      setShow(false);
    }
  };

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    setShow(false);
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          transition={{ duration: 0.3 }}
          className="fixed bottom-6 inset-x-6 sm:inset-x-auto sm:inset-e-6 sm:max-w-sm z-50"
        >
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-2xl dark:shadow-black/40 p-4 flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-100 dark:bg-sky-500/10 flex items-center justify-center shrink-0">
              <Bell className="h-5 w-5 text-sky-600 dark:text-sky-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {t('notifications.pushTitle')}
              </p>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                {t('notifications.pushDesc')}
              </p>
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={handleEnable}
                  disabled={subscribing}
                  className="px-4 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {subscribing ? t('common.loading') : t('notifications.enablePush')}
                </button>
                <button
                  onClick={handleDismiss}
                  className="px-3 py-1.5 text-xs text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 transition-colors cursor-pointer"
                >
                  {t('notifications.notNow')}
                </button>
              </div>
            </div>
            <button onClick={handleDismiss} className="text-gray-300 dark:text-slate-600 hover:text-gray-500 dark:hover:text-slate-400 cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
