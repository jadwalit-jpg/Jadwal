'use client';

import React, { useState } from 'react';
import { useAuth } from '@/context/auth-context';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, ExternalLink } from 'lucide-react';
import { sanitize, validateLoginForm } from '@/lib/validation';
import { getApiError } from '@/lib/utils';
import api from '@/lib/api';

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, checkAuth } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const sanitizedEmail = sanitize(email);
    const check = validateLoginForm(sanitizedEmail, password);
    if (!check.valid) { setError(check.error); setLoading(false); return; }

    try {
      const loggedInUser = await login(sanitizedEmail, password);
      if (loggedInUser.role !== 'ADMIN') {
        await api.post('/auth/logout');
        await checkAuth();
        setError('Access denied. This portal is for administrators only.');
        setLoading(false);
        return;
      }
      router.push('/admin/dashboard');
    } catch (err) {
      setError(getApiError(err, 'Invalid credentials or access denied'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-svh lg:grid-cols-2 font-outfit">
      {/* Left — Form */}
      <div className="flex flex-col gap-4 p-6 md:p-10 bg-white dark:bg-slate-950">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
            <div className="flex size-7 items-center justify-center rounded-lg bg-blue-600 text-white">
              <ShieldCheck className="size-4" />
            </div>
            <span>Jadwal</span>
            <span className="text-blue-600">Admin</span>
          </div>
          <Link
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-gray-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-all"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View Site
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Admin Sign In</h1>
              <p className="text-sm text-gray-500 dark:text-slate-400">
                Sign in to manage the Jadwal platform
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <p className="text-red-600 dark:text-red-400 text-sm font-medium">{error}</p>
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="admin-login-email" className="text-sm font-medium text-gray-700 dark:text-slate-300 ms-0.5">
                  Email Address
                </label>
                <input
                  id="admin-login-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm text-gray-900 dark:text-white outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-slate-600"
                  placeholder="admin@jadwal.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center ms-0.5">
                  <label htmlFor="admin-login-password" className="text-sm font-medium text-gray-700 dark:text-slate-300">Password</label>
                </div>
                <input
                  id="admin-login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm text-gray-900 dark:text-white outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-slate-600"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm"
              >
                {loading ? 'Authenticating...' : 'Sign In'}
              </button>
            </form>

            <p className="mt-8 text-center text-xs text-gray-400 dark:text-slate-600">
              &copy; 2026 Jadwal Platform. Secure Infrastructure Enabled.
            </p>
          </div>
        </div>
      </div>

      {/* Right — Visual */}
      <div className="relative hidden lg:block overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-700" />
        <div className="absolute top-20 -start-20 w-96 h-96 bg-white/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-20 -end-20 w-80 h-80 bg-blue-400/20 rounded-full blur-[80px]" />

        <div className="relative flex flex-col items-center justify-center h-full p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center mb-6">
            <ShieldCheck className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-3xl font-bold text-white mb-3">Jadwal Admin Panel</h2>
          <p className="text-blue-100 max-w-sm leading-relaxed">
            Manage vendors, activities, bookings, and platform settings from a single dashboard.
          </p>
        </div>
      </div>
    </div>
  );
}
