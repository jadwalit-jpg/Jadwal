'use client';

import { useState, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Lock, CheckCircle, Loader2, Eye, EyeOff } from 'lucide-react';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { validatePassword } from '@/lib/validation';
import Navbar from '@/components/navbar';
import { useToast } from '@/components/toast';

function ResetPasswordContent() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: (data: { token: string; newPassword: string }) =>
      api.post('/auth/reset-password', data),
    onSuccess: () => {
      setDone(true);
      setTimeout(() => router.push('/login'), 3000);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      toast(pwCheck.error, 'error');
      return;
    }
    if (password !== confirm) {
      toast(t('auth.toast.passwordsNoMatch'), 'error');
      return;
    }
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      toast(t('auth.toast.invalidResetLink'), 'error');
      return;
    }
    mutation.mutate({ token, newPassword: password });
  };

  if (!token) {
    return (
      <div className="text-center space-y-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('auth.invalidResetLink')}</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400">{t('auth.invalidResetLinkDesc')}</p>
        <Link href="/forgot-password" className="text-sm text-sky-600 dark:text-blue-400 hover:underline">
          {t('auth.requestNewLink')}
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-xl p-8">
      {done ? (
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <CheckCircle className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('auth.passwordReset')}</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">{t('auth.passwordChanged')}</p>
          <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('auth.redirecting')}
          </div>
        </div>
      ) : (
        <>
          <div className="text-center mb-6">
            <div className="w-14 h-14 mx-auto rounded-full bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center mb-4">
              <Lock className="h-7 w-7 text-sky-600 dark:text-sky-400" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('auth.setNewPassword')}</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              {t('auth.setNewPasswordDesc')}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="reset-password" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">{t('auth.newPassword')}</label>
              <div className="relative">
                <input
                  id="reset-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="A-Z, a-z, 0-9, min 8 chars"
                  className="w-full px-4 py-3 pe-12 bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute inset-e-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="reset-password-confirm" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">{t('auth.confirmPassword')}</label>
              <input
                id="reset-password-confirm"
                name="passwordConfirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                placeholder={t('auth.repeatPassword')}
                className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all"
              />
            </div>

            {mutation.isError && (
              <p className="text-xs text-red-500">{getApiError(mutation.error, 'Reset failed. The link may have expired.')}</p>
            )}

            <button
              type="submit"
              disabled={mutation.isPending || !password || !confirm}
              className="w-full py-3 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('auth.resetPassword')}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link href="/login" className="text-sm text-gray-500 dark:text-slate-400 hover:text-sky-600 transition-colors">
              {t('auth.backToLogin')}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-svh bg-gray-50 dark:bg-slate-950 flex flex-col">
      <Navbar variant="solid" />

      <main className="flex-1 flex items-center justify-center px-4 pt-24 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <Suspense fallback={
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          }>
            <ResetPasswordContent />
          </Suspense>
        </motion.div>
      </main>
    </div>
  );
}
