'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { sanitize, validatePassword } from '@/lib/validation';
import { useToast } from '@/components/toast';
import AdminLayout from '../_components/admin-layout';
import { Eye, EyeOff, User, Lock } from 'lucide-react';
import ActiveSessions from '@/components/active-sessions';

const inputCls =
  'w-full px-4 py-2.5 bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all';
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5';

export default function AdminProfilePage() {
  const [profile, setProfile] = useState({ fullName: '', phone: '' });
  const [password, setPassword] = useState({ current: '', new: '', confirm: '' });
  const [showPass, setShowPass] = useState({ current: false, new: false, confirm: false });
  const { toast } = useToast();

  const { data: profileData, isLoading } = useQuery({
    queryKey: ['admin', 'profile'],
    queryFn: () => api.get('/admin/profile').then((r) => r.data),
  });

  useEffect(() => {
    if (profileData) {
      setProfile({
        fullName: profileData.fullName ?? '',
        phone: profileData.phone ?? '',
      });
    }
  }, [profileData]);

  const profileMutation = useMutation({
    mutationFn: (payload: any) => api.patch('/admin/profile', payload),
    onSuccess: () => toast('Profile updated successfully'),
    onError: (err) => toast(getApiError(err, 'Failed to update profile'), 'error'),
  });

  const passwordMutation = useMutation({
    mutationFn: (payload: any) => api.patch('/admin/profile/password', payload),
    onSuccess: () => {
      toast('Password changed successfully');
      setPassword({ current: '', new: '', confirm: '' });
    },
    onError: (err) => toast(getApiError(err, 'Failed to change password'), 'error'),
  });

  function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault();
    profileMutation.mutate({
      fullName: sanitize(profile.fullName),
      phone: sanitize(profile.phone),
    });
  }

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.current || !password.new || !password.confirm) {
      toast('All password fields are required', 'error');
      return;
    }
    const pwCheck = validatePassword(password.new);
    if (!pwCheck.valid) {
      toast(pwCheck.error, 'error');
      return;
    }
    if (password.new !== password.confirm) {
      toast('New passwords do not match', 'error');
      return;
    }
    passwordMutation.mutate({
      currentPassword: password.current,
      newPassword: password.new,
    });
  }

  return (
    <AdminLayout title="Admin Profile" subtitle="Manage your account settings">
      <div className="max-w-2xl space-y-8">
        {/* Profile Information */}
        <div className="bg-white dark:bg-slate-900/50 rounded-2xl border border-gray-200/80 dark:border-slate-800/80 overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-100 dark:border-slate-800">
            <div className="p-2 rounded-xl bg-blue-500/10">
              <User className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Profile Information</h2>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Update your name and phone number</p>
            </div>
          </div>
          <form onSubmit={handleProfileSubmit} className="p-6 space-y-5">
            <div>
              <label className={labelCls}>Email Address</label>
              <input
                type="email"
                value={profileData?.email ?? ''}
                disabled
                readOnly
                className={`${inputCls} opacity-60 cursor-not-allowed`}
              />
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Email cannot be changed.</p>
            </div>
            <div>
              <label className={labelCls}>Full Name <span className="text-red-500">*</span></label>
              {isLoading ? (
                <div className="h-10 bg-gray-100 dark:bg-slate-800 rounded-xl animate-pulse" />
              ) : (
                <input
                  type="text"
                  value={profile.fullName}
                  onChange={(e) => setProfile((p) => ({ ...p, fullName: e.target.value }))}
                  required
                  placeholder="Your full name"
                  className={inputCls}
                />
              )}
            </div>
            <div>
              <label className={labelCls}>Phone Number</label>
              {isLoading ? (
                <div className="h-10 bg-gray-100 dark:bg-slate-800 rounded-xl animate-pulse" />
              ) : (
                <input
                  type="tel"
                  value={profile.phone}
                  onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="+974 5000 0000"
                  className={inputCls}
                />
              )}
            </div>
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={profileMutation.isPending || isLoading}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50 cursor-pointer"
              >
                {profileMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>

        {/* Change Password */}
        <div className="bg-white dark:bg-slate-900/50 rounded-2xl border border-gray-200/80 dark:border-slate-800/80 overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-100 dark:border-slate-800">
            <div className="p-2 rounded-xl bg-indigo-500/10">
              <Lock className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Change Password</h2>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Update your account password</p>
            </div>
          </div>
          <form onSubmit={handlePasswordSubmit} className="p-6 space-y-5">
            {(['current', 'new', 'confirm'] as const).map((field) => {
              const labels = { current: 'Current Password', new: 'New Password', confirm: 'Confirm New Password' };
              return (
                <div key={field}>
                  <label className={labelCls}>{labels[field]} <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <input
                      type={showPass[field] ? 'text' : 'password'}
                      value={password[field]}
                      onChange={(e) => setPassword((p) => ({ ...p, [field]: e.target.value }))}
                      required
                      placeholder={field === 'current' ? 'Your current password' : field === 'new' ? 'A-Z, a-z, 0-9, min 8 chars' : 'Repeat new password'}
                      className={`${inputCls} pe-11`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((s) => ({ ...s, [field]: !s[field] }))}
                      className="absolute end-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors cursor-pointer"
                      tabIndex={-1}
                    >
                      {showPass[field]
                        ? <EyeOff className="h-4 w-4" />
                        : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              );
            })}
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={passwordMutation.isPending}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-all disabled:opacity-50 cursor-pointer"
              >
                {passwordMutation.isPending ? 'Changing...' : 'Change Password'}
              </button>
            </div>
          </form>
        </div>

        {/* Active Sessions */}
        <div className="bg-white dark:bg-slate-900/60 rounded-2xl border border-gray-200 dark:border-slate-800 p-6">
          <ActiveSessions />
        </div>
      </div>
    </AdminLayout>
  );
}
