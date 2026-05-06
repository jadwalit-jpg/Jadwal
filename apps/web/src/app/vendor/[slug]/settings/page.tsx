'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/auth-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { sanitize, validatePassword } from '@/lib/validation';
import { useToast } from '@/components/toast';
import { VendorSidebar } from '../../_components/vendor-sidebar';
import { Loader2, Eye, EyeOff } from 'lucide-react';

const inputCls =
  'w-full px-4 py-2.5 bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500';

function FieldGroup({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">{label}</label>
      {children}
      {hint ? <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">{hint}</p> : null}
    </div>
  );
}

const PASSWORD_ERROR_KEYS: Record<string, string> = {
  'Password is required': 'vendor.settings.password.validation.required',
  'Password must be at least 8 characters': 'vendor.settings.password.validation.minLength',
  'Password is too long': 'vendor.settings.password.validation.tooLong',
  'Password must contain at least one lowercase letter': 'vendor.settings.password.validation.needLower',
  'Password must contain at least one uppercase letter': 'vendor.settings.password.validation.needUpper',
  'Password must contain at least one number': 'vendor.settings.password.validation.needNumber',
};

function translatePasswordValidation(t: TFunction, error: string) {
  const key = PASSWORD_ERROR_KEYS[error];
  return key ? t(key) : error;
}

export default function VendorSettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [profile, setProfile] = useState({
    businessNameEn: '',
    businessNameAr: '',
    descriptionEn: '',
    descriptionAr: '',
    phone: '',
    whatsapp: '',
    website: '',
  });

  const [bank, setBank] = useState({
    bankName: '',
    accountHolder: '',
    iban: '',
  });

  const [password, setPassword] = useState({ current: '', new: '', confirm: '' });
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false });

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: [user?.id, 'vendor-settings'],
    queryFn: () => api.get('/vendor/settings').then((r) => r.data),
    enabled: !!user,
  });

  useEffect(() => {
    if (settings) {
      setProfile({
        businessNameEn: settings.businessNameEn ?? '',
        businessNameAr: settings.businessNameAr ?? '',
        descriptionEn: settings.descriptionEn ?? '',
        descriptionAr: settings.descriptionAr ?? '',
        phone: settings.phone ?? '',
        whatsapp: settings.whatsapp ?? '',
        website: settings.website ?? '',
      });
      const bd = settings.bankDetails as { bankName?: string; accountHolder?: string; iban?: string } | null;
      if (bd) {
        setBank({
          bankName: bd.bankName ?? '',
          accountHolder: bd.accountHolder ?? '',
          iban: bd.iban ?? '',
        });
      }
    }
  }, [settings]);

  const profileMutation = useMutation({
    mutationFn: (data: unknown) => api.patch('/vendor/settings', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-settings'] });
      toast(t('vendor.settings.profile.toastOk'), 'success');
    },
    onError: () => toast(t('vendor.settings.profile.toastFail'), 'error'),
  });

  const bankMutation = useMutation({
    mutationFn: (data: unknown) => api.patch('/vendor/settings', { bankDetails: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-settings'] });
      toast(t('vendor.settings.bank.toastOk'), 'success');
    },
    onError: () => toast(t('vendor.settings.bank.toastFail'), 'error'),
  });

  const passwordMutation = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) => api.patch('/vendor/settings/password', data),
    onSuccess: () => {
      toast(t('vendor.settings.password.toastOk'), 'success');
      setPassword({ current: '', new: '', confirm: '' });
    },
    onError: (err) => toast(getApiError(err, t('vendor.settings.password.toastFail')), 'error'),
  });

  const handleProfileSave = (e: React.FormEvent) => {
    e.preventDefault();
    profileMutation.mutate({
      businessNameEn: sanitize(profile.businessNameEn),
      businessNameAr: sanitize(profile.businessNameAr),
      descriptionEn: sanitize(profile.descriptionEn),
      descriptionAr: sanitize(profile.descriptionAr),
      phone: sanitize(profile.phone),
      whatsapp: sanitize(profile.whatsapp),
      website: sanitize(profile.website),
    });
  };

  const handleBankSave = (e: React.FormEvent) => {
    e.preventDefault();
    bankMutation.mutate({
      bankName: sanitize(bank.bankName),
      accountHolder: sanitize(bank.accountHolder),
      iban: bank.iban.toUpperCase().replace(/\s/g, ''),
    });
  };

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.current || !password.new || !password.confirm) {
      toast(t('vendor.settings.password.allFieldsRequired'), 'error');
      return;
    }
    const pwCheck = validatePassword(password.new);
    if (!pwCheck.valid) {
      toast(translatePasswordValidation(t, pwCheck.error!), 'error');
      return;
    }
    if (password.new !== password.confirm) {
      toast(t('vendor.settings.password.mismatch'), 'error');
      return;
    }
    passwordMutation.mutate({ currentPassword: password.current, newPassword: password.new });
  };

  const updateProfile = (k: string, v: string) => setProfile((p) => ({ ...p, [k]: v }));
  const updateBank = (k: string, v: string) => setBank((p) => ({ ...p, [k]: v }));

  if (settingsLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-950 font-outfit">
        <VendorSidebar />
        <main className="md:ms-64 p-4 md:p-10 overflow-x-hidden space-y-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 rounded-2xl animate-pulse" />
          ))}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 font-outfit text-gray-900 dark:text-white">
      <VendorSidebar />

      <main className="md:ms-64 p-4 md:p-10 overflow-x-hidden max-w-3xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('vendor.settings.title')}</h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1">{t('vendor.settings.subtitle')}</p>
        </div>

        <section className="bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 rounded-2xl p-6">
          <h2 className="text-lg font-bold mb-5">{t('vendor.settings.profile.sectionTitle')}</h2>
          <form onSubmit={handleProfileSave} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FieldGroup label={t('vendor.settings.profile.businessNameEn')}>
                <input
                  value={profile.businessNameEn}
                  onChange={(e) => updateProfile('businessNameEn', e.target.value)}
                  className={inputCls}
                  placeholder={t('vendor.settings.profile.placeholderBusinessEn')}
                />
              </FieldGroup>
              <FieldGroup label={t('vendor.settings.profile.businessNameAr')}>
                <input
                  value={profile.businessNameAr}
                  onChange={(e) => updateProfile('businessNameAr', e.target.value)}
                  className={inputCls}
                  placeholder={t('vendor.settings.profile.placeholderBusinessAr')}
                  dir="rtl"
                />
              </FieldGroup>
              <FieldGroup label={t('vendor.settings.profile.phone')}>
                <input
                  value={profile.phone}
                  onChange={(e) => updateProfile('phone', e.target.value)}
                  className={inputCls}
                  placeholder={t('vendor.settings.profile.placeholderPhone')}
                />
              </FieldGroup>
              <FieldGroup label={t('vendor.settings.profile.whatsapp')}>
                <input
                  value={profile.whatsapp}
                  onChange={(e) => updateProfile('whatsapp', e.target.value)}
                  className={inputCls}
                  placeholder={t('vendor.settings.profile.placeholderPhone')}
                />
              </FieldGroup>
              <FieldGroup label={t('vendor.settings.profile.website')} hint={t('vendor.settings.profile.websiteOptional')}>
                <input
                  value={profile.website}
                  onChange={(e) => updateProfile('website', e.target.value)}
                  className={inputCls}
                  placeholder={t('vendor.settings.profile.placeholderWebsite')}
                />
              </FieldGroup>
            </div>
            <FieldGroup label={t('vendor.settings.profile.descriptionEn')}>
              <textarea
                value={profile.descriptionEn}
                onChange={(e) => updateProfile('descriptionEn', e.target.value)}
                className={`${inputCls} min-h-[80px]`}
                placeholder={t('vendor.settings.profile.placeholderDescriptionEn')}
              />
            </FieldGroup>
            <FieldGroup label={t('vendor.settings.profile.descriptionAr')}>
              <textarea
                value={profile.descriptionAr}
                onChange={(e) => updateProfile('descriptionAr', e.target.value)}
                className={`${inputCls} min-h-[80px]`}
                placeholder={t('vendor.settings.profile.placeholderDescriptionAr')}
                dir="rtl"
              />
            </FieldGroup>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={profileMutation.isPending}
                className="flex items-center gap-2 px-6 py-2.5 bg-linear-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
              >
                {profileMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('vendor.settings.profile.save')}
              </button>
            </div>
          </form>
        </section>

        <section className="bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 rounded-2xl p-6">
          <h2 className="text-lg font-bold mb-1">{t('vendor.settings.bank.sectionTitle')}</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-5">
            {t('vendor.settings.bank.intro', {
              defaultValue: 'Used for weekly payout transfers. Stored securely.',
            })}
          </p>
          <form onSubmit={handleBankSave} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FieldGroup label={t('vendor.settings.bank.bankName')}>
                <input
                  value={bank.bankName}
                  onChange={(e) => updateBank('bankName', e.target.value)}
                  className={inputCls}
                  placeholder={t('vendor.settings.bank.placeholderBankName')}
                />
              </FieldGroup>
              <FieldGroup label={t('vendor.settings.bank.accountHolder')}>
                <input
                  value={bank.accountHolder}
                  onChange={(e) => updateBank('accountHolder', e.target.value)}
                  className={inputCls}
                  placeholder={t('vendor.settings.bank.placeholderAccountHolder')}
                />
              </FieldGroup>
            </div>
            <FieldGroup label={t('vendor.settings.bank.iban')} hint={t('vendor.settings.bank.ibanHint')}>
              <input
                value={bank.iban}
                onChange={(e) => updateBank('iban', e.target.value.toUpperCase())}
                className={inputCls}
                placeholder={t('vendor.settings.bank.placeholderIban')}
                maxLength={34}
              />
            </FieldGroup>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={bankMutation.isPending}
                className="flex items-center gap-2 px-6 py-2.5 bg-linear-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
              >
                {bankMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('vendor.settings.bank.save')}
              </button>
            </div>
          </form>
        </section>

        <section className="bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 rounded-2xl p-6">
          <h2 className="text-lg font-bold mb-1">{t('vendor.settings.password.sectionTitle')}</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-5">{t('vendor.settings.password.intro')}</p>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <FieldGroup label={t('vendor.settings.password.current')}>
              <div className="relative">
                <input
                  type={showPasswords.current ? 'text' : 'password'}
                  value={password.current}
                  onChange={(e) => setPassword((p) => ({ ...p, current: e.target.value }))}
                  className={`${inputCls} pe-10`}
                  placeholder={t('vendor.settings.password.placeholderCurrent')}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPasswords((p) => ({ ...p, current: !p.current }))}
                  className="absolute inset-e-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
                >
                  {showPasswords.current ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </FieldGroup>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FieldGroup label={t('vendor.settings.password.new')}>
                <div className="relative">
                  <input
                    type={showPasswords.new ? 'text' : 'password'}
                    value={password.new}
                    onChange={(e) => setPassword((p) => ({ ...p, new: e.target.value }))}
                    className={`${inputCls} pe-10`}
                    placeholder={t('vendor.settings.password.placeholderNew')}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords((p) => ({ ...p, new: !p.new }))}
                    className="absolute inset-e-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
                  >
                    {showPasswords.new ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </FieldGroup>
              <FieldGroup label={t('vendor.settings.password.confirm')}>
                <div className="relative">
                  <input
                    type={showPasswords.confirm ? 'text' : 'password'}
                    value={password.confirm}
                    onChange={(e) => setPassword((p) => ({ ...p, confirm: e.target.value }))}
                    className={`${inputCls} pe-10`}
                    placeholder={t('vendor.settings.password.placeholderConfirm')}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords((p) => ({ ...p, confirm: !p.confirm }))}
                    className="absolute inset-e-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
                  >
                    {showPasswords.confirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </FieldGroup>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={passwordMutation.isPending}
                className="flex items-center gap-2 px-6 py-2.5 bg-linear-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
              >
                {passwordMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('vendor.settings.password.submit')}
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
