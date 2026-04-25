'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Mail, ArrowLeft, CheckCircle, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { getApiError } from '@/lib/utils';
import { sanitize } from '@/lib/validation';
import Navbar from '@/components/navbar';

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const mutation = useMutation({
    mutationFn: (email: string) => api.post('/auth/forgot-password', { email: sanitize(email).trim().toLowerCase() }),
    onSuccess: () => setSent(true),
  });

  return (
    <div className="min-h-svh bg-gray-50 dark:bg-slate-950 flex flex-col">
      <Navbar variant="solid" />

      <main className="flex-1 flex items-center justify-center px-4 pt-24 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-xl p-8">
            {sent ? (
              <div className="text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                  <CheckCircle className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('auth.checkEmail')}</h1>
                <p className="text-sm text-gray-500 dark:text-slate-400">
                  {t('auth.resetLinkSent')}
                </p>
                <p className="text-xs text-gray-400 dark:text-slate-500">
                  {t('auth.linkExpiresOneHour')}
                </p>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 text-sm text-sky-600 dark:text-blue-400 hover:underline mt-4"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {t('auth.backToLogin')}
                </Link>
              </div>
            ) : (
              <>
                <div className="text-center mb-6">
                  <div className="w-14 h-14 mx-auto rounded-full bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center mb-4">
                    <Mail className="h-7 w-7 text-sky-600 dark:text-sky-400" />
                  </div>
                  <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('auth.forgotPasswordTitle')}</h1>
                  <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                    {t('auth.forgotPasswordDesc')}
                  </p>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!email.trim()) return;
                    mutation.mutate(email);
                  }}
                  className="space-y-4"
                >
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">{t('auth.emailPlaceholder')}</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus
                      placeholder="you@example.com"
                      className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all"
                    />
                  </div>

                  {mutation.isError && (
                    <p className="text-xs text-red-500">{getApiError(mutation.error, 'Something went wrong. Please try again.')}</p>
                  )}

                  <button
                    type="submit"
                    disabled={mutation.isPending || !email.trim()}
                    className="w-full py-3 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    {t('auth.sendResetLink')}
                  </button>
                </form>

                <div className="mt-6 text-center">
                  <Link href="/login" className="text-sm text-gray-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-blue-400 transition-colors">
                    {t('auth.backToLogin')}
                  </Link>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </main>
    </div>
  );
}
