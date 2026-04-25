'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/components/toast';
import api from '@/lib/api';
import { localized } from '@/lib/localize';
import Link from 'next/link';
import { Building2, CheckCircle, LogIn, UserPlus } from 'lucide-react';
import { sanitize, sanitizeObject, validateEmail, validatePassword, validateFullName, validatePhone, validateSlug } from '@/lib/validation';
import { getApiError } from '@/lib/utils';
import CustomSelect from '@/components/custom-select';

interface Country {
  id: string;
  nameEn: string;
  isoCode: string;
}

const inputCls =
  'w-full px-4 py-3 bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm text-gray-900 dark:text-white outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-slate-600';

export default function VendorAuthPage() {
  return (
    <Suspense>
      <VendorAuthContent />
    </Suspense>
  );
}

function VendorAuthContent() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const { user, loading, login, checkAuth } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [registerError, setRegisterError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);
  const [countryId, setCountryId] = useState('');
  const [businessNameEn, setBusinessNameEn] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  const toSlug = (name: string) =>
    name.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  const handleBusinessNameChange = (value: string) => {
    setBusinessNameEn(value);
    if (!slugTouched) setSlug(toSlug(value));
  };

  const { data: countries } = useQuery<Country[]>({
    queryKey: ['public', 'countries'],
    queryFn: async () => {
      const { data } = await api.get('/catalog/countries');
      return data;
    },
  });

  useEffect(() => {
    if (!loading && user) {
      if (user.role === 'VENDOR') router.push(`/vendor/${user.vendor?.slug ?? 'portal'}/dashboard`);
    }
  }, [user, loading, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError('');

    try {
      const loggedInUser = await login(email, password);
      if (loggedInUser.role !== 'VENDOR') {
        await api.post('/auth/logout');
        await checkAuth();
        setLoginError('Access denied. This portal is for vendors only.');
        setIsLoggingIn(false);
        return;
      }
      router.push(`/vendor/${loggedInUser.vendor?.slug ?? 'portal'}/dashboard`);
    } catch (err) {
      setLoginError(getApiError(err, 'Invalid email or password'));
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setRegisterError('');
    const errs: Record<string, string> = {};

    const fd = new FormData(e.currentTarget);
    const fullName = sanitize((fd.get('fullName') as string) || '');
    const emailVal = sanitize((fd.get('email') as string) || '');
    const rawPhone = ((fd.get('phone') as string) || '').replace(/[\s\-()]/g, '');
    const phone = sanitize(rawPhone);
    const pw = (fd.get('password') as string) || '';
    const confirmPw = (fd.get('confirmPassword') as string) || '';
    const businessNameEn = sanitize((fd.get('businessNameEn') as string) || '');
    const businessNameAr = sanitize((fd.get('businessNameAr') as string) || '');
    const businessId = sanitize((fd.get('businessId') as string) || '');
    const slug = sanitize((fd.get('slug') as string) || '');
    const countryId = (fd.get('countryId') as string) || '';

    // Per-field validation
    const nameCheck = validateFullName(fullName);
    if (!nameCheck.valid) errs.fullName = (nameCheck as { error: string }).error;

    const emailCheck = validateEmail(emailVal);
    if (!emailCheck.valid) errs.email = (emailCheck as { error: string }).error;

    const pwCheck = validatePassword(pw);
    if (!pwCheck.valid) errs.password = (pwCheck as { error: string }).error;

    if (pw && confirmPw && pw !== confirmPw) errs.confirmPassword = 'Passwords do not match';
    else if (!confirmPw) errs.confirmPassword = 'Please confirm your password';

    if (phone) {
      const phoneCheck = validatePhone(rawPhone);
      if (!phoneCheck.valid) errs.phone = (phoneCheck as { error: string }).error;
    }

    if (!businessNameEn.trim()) errs.businessNameEn = 'Business name (English) is required';
    if (!businessNameAr.trim()) errs.businessNameAr = 'Business name (Arabic) is required';
    if (!businessId.trim()) errs.businessId = 'Business ID is required';

    const slugCheck = validateSlug(slug);
    if (!slugCheck.valid) errs.slug = (slugCheck as { error: string }).error;

    if (!countryId) errs.countryId = 'Please select a country';

    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setIsSubmitting(false);
      return;
    }

    setFieldErrors({});

    try {
      await api.post('/auth/register/vendor', {
        ...sanitizeObject({
          fullName,
          email: emailVal,
          businessNameEn,
          businessNameAr,
          businessId,
          slug,
          phone: phone || undefined,
          countryId,
        }),
        password: pw, // Never sanitize passwords — sanitize() strips valid chars like <, >
      });

      setSuccess(true);
      toast(t('vendor.toast.registrationSubmitted'));
    } catch (err) {
      const msg = getApiError(err, 'Registration failed. Please try again.');
      setRegisterError(msg);
      toast(msg, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return null;

  // Success screen
  if (success) {
    return (
      <div className="grid min-h-svh lg:grid-cols-2 font-outfit">
        <div className="flex flex-col gap-4 p-6 md:p-10 bg-white dark:bg-slate-950">
          <div className="flex justify-center gap-2 md:justify-start">
            <Link href="/" className="flex items-center gap-1 font-bold">
              <span className="text-xl text-gray-900 dark:text-white">Jadwal</span>
              <span className="text-xl text-blue-600">جدول</span>
            </Link>
          </div>
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-sm text-center">
              <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-6">
                <CheckCircle className="h-8 w-8 text-emerald-500" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">{t('vendor.registrationSubmitted')}</h2>
              <p className="text-sm text-gray-500 dark:text-slate-400 mb-8">
                {t('vendor.pendingApproval')}
              </p>
              <button
                type="button"
                onClick={() => { setSuccess(false); setMode('login'); }}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all"
              >
                {t('vendor.goToLogin')}
              </button>
            </div>
          </div>
        </div>
        <RightPanel />
      </div>
    );
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-2 font-outfit">
      {/* Left — Form */}
      <div className="flex flex-col gap-4 p-6 md:p-10 bg-white dark:bg-slate-950">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link href="/" className="flex items-center gap-1 font-bold">
            <span className="text-xl text-gray-900 dark:text-white">Jadwal</span>
            <span className="text-xl text-blue-600">جدول</span>
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-md">
            {/* Header */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">{t('vendor.portalTitle')}</h1>
              <p className="text-sm text-gray-500 dark:text-slate-400">
                {mode === 'login' ? t('vendor.signInDesc') : t('vendor.joinDesc')}
              </p>
            </div>

            {/* Toggle Switch */}
            <div className="mb-6">
              <div className="relative bg-gray-100 dark:bg-slate-900/60 border border-gray-200 dark:border-slate-800 rounded-xl p-1 flex items-center">
                <div
                  className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-blue-600 rounded-lg shadow-lg shadow-blue-600/20 transition-all duration-300 ease-out ${
                    mode === 'login' ? 'inset-s-1' : 'inset-s-[calc(50%+2px)]'
                  }`}
                />

                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className={`relative z-10 flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors duration-300 ${
                    mode === 'login' ? 'text-white' : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
                  }`}
                >
                  <LogIn className="h-4 w-4" />
                  {t('vendor.signIn')}
                </button>

                <button
                  type="button"
                  onClick={() => setMode('register')}
                  className={`relative z-10 flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors duration-300 ${
                    mode === 'register' ? 'text-white' : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
                  }`}
                >
                  <UserPlus className="h-4 w-4" />
                  {t('vendor.register')}
                </button>
              </div>
            </div>

            {/* Login Form */}
            {mode === 'login' && (
              <form onSubmit={handleLogin} className="space-y-4">
                {loginError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                    <p className="text-red-600 dark:text-red-400 text-sm font-medium">{loginError}</p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-slate-300 ms-0.5">{t('auth.emailAddress')}</label>
                  <input
                    type="email"
                    required
                    className={inputCls}
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center ms-0.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-slate-300">{t('auth.password')}</label>
                  </div>
                  <input
                    type="password"
                    required
                    className={inputCls}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoggingIn}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm"
                >
                  {isLoggingIn ? t('auth.signingIn') : t('vendor.signIn')}
                </button>
              </form>
            )}

            {/* Register Form */}
            {mode === 'register' && (
              <form onSubmit={handleRegister} className="space-y-4">
                {registerError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                    <p className="text-red-600 dark:text-red-400 text-sm font-medium">{registerError}</p>
                  </div>
                )}

                {/* Account Details */}
                <div>
                  <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2 ms-0.5">{t('vendor.accountDetails')}</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <input name="fullName" type="text" placeholder={t('auth.fullName')} className={`${inputCls} ${fieldErrors.fullName ? '!border-red-500' : ''}`} />
                      {fieldErrors.fullName && <p className="text-xs text-red-500 mt-1 ms-0.5">{fieldErrors.fullName}</p>}
                    </div>
                    <div>
                      <input name="email" type="email" placeholder={t('auth.emailAddress')} className={`${inputCls} ${fieldErrors.email ? '!border-red-500' : ''}`} />
                      {fieldErrors.email && <p className="text-xs text-red-500 mt-1 ms-0.5">{fieldErrors.email}</p>}
                    </div>
                    <div>
                      <input name="phone" type="tel" placeholder={t('auth.phone')} maxLength={16} className={`${inputCls} ${fieldErrors.phone ? '!border-red-500' : ''}`} />
                      {fieldErrors.phone && <p className="text-xs text-red-500 mt-1 ms-0.5">{fieldErrors.phone}</p>}
                    </div>
                    <div>
                      <input name="password" type="password" placeholder={t('auth.passwordHint')} className={`${inputCls} ${fieldErrors.password ? '!border-red-500' : ''}`} />
                      {fieldErrors.password && <p className="text-xs text-red-500 mt-1 ms-0.5">{fieldErrors.password}</p>}
                    </div>
                    <div className="col-span-2">
                      <input name="confirmPassword" type="password" placeholder={t('auth.confirmPassword')} className={`${inputCls} ${fieldErrors.confirmPassword ? '!border-red-500' : ''}`} />
                      {fieldErrors.confirmPassword && <p className="text-xs text-red-500 mt-1 ms-0.5">{fieldErrors.confirmPassword}</p>}
                    </div>
                  </div>
                </div>

                {/* Business Details */}
                <div>
                  <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2 ms-0.5">{t('vendor.businessDetails')}</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <input name="businessNameEn" type="text" placeholder={t('vendor.businessNameEn')} value={businessNameEn} onChange={(e) => handleBusinessNameChange(e.target.value)} className={`${inputCls} ${fieldErrors.businessNameEn ? '!border-red-500' : ''}`} />
                      {fieldErrors.businessNameEn && <p className="text-xs text-red-500 mt-1 ms-0.5">{fieldErrors.businessNameEn}</p>}
                    </div>
                    <div>
                      <input name="businessNameAr" type="text" placeholder={t('vendor.businessNameAr')} className={`${inputCls} ${fieldErrors.businessNameAr ? '!border-red-500' : ''}`} />
                      {fieldErrors.businessNameAr && <p className="text-xs text-red-500 mt-1 ms-0.5">{fieldErrors.businessNameAr}</p>}
                    </div>
                    <div>
                      <input name="businessId" type="text" placeholder={t('vendor.businessId')} className={`${inputCls} ${fieldErrors.businessId ? '!border-red-500' : ''}`} />
                      {fieldErrors.businessId && <p className="text-xs text-red-500 mt-1 ms-0.5">{fieldErrors.businessId}</p>}
                    </div>
                    <div>
                      <input name="slug" type="text" placeholder={t('vendor.slugHint')} pattern="[a-z0-9-]+" title="Only lowercase letters, numbers, and hyphens" value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }} className={`${inputCls} ${fieldErrors.slug ? '!border-red-500' : ''}`} />
                      {fieldErrors.slug && <p className="text-xs text-red-500 mt-1 ms-0.5">{fieldErrors.slug}</p>}
                    </div>
                    <div className="col-span-2">
                      <input type="hidden" name="countryId" value={countryId} readOnly />
                      <CustomSelect
                        options={countries?.map((c) => ({ value: c.id, label: `${localized(c, 'name')} (${c.isoCode})` })) ?? []}
                        value={countryId}
                        onChange={(val) => setCountryId(val)}
                        placeholder={t('vendor.selectCountry')}
                        className="w-full"
                      />
                      {fieldErrors.countryId && <p className="text-xs text-red-500 mt-1 ms-0.5">{fieldErrors.countryId}</p>}
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm"
                >
                  {isSubmitting ? t('vendor.submitting') : t('vendor.submitRegistration')}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Right — Visual */}
      <RightPanel />
    </div>
  );
}

function RightPanel() {
  const { t } = useTranslation();
  return (
    <div className="relative hidden lg:block overflow-hidden">
      <div className="absolute inset-0 bg-linear-to-br from-blue-600 via-indigo-600 to-violet-700" />
      <div className="absolute top-20 -inset-s-20 w-96 h-96 bg-white/10 rounded-full blur-[100px]" />
      <div className="absolute bottom-20 -inset-e-20 w-80 h-80 bg-blue-400/20 rounded-full blur-[80px]" />

      <div className="relative flex flex-col items-center justify-center h-full p-12 text-center">
        <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center mb-6">
          <Building2 className="h-8 w-8 text-white" />
        </div>
        <h2 className="text-3xl font-bold text-white mb-3">{t('vendor.growBusiness')}</h2>
        <p className="text-blue-100 max-w-sm leading-relaxed">
          {t('vendor.growBusinessDesc')}
        </p>
      </div>
    </div>
  );
}
