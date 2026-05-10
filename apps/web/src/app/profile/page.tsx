'use client';

import React, { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { AccountDataControls } from '@/components/account-data-controls';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Coins,
  DollarSign,
  Edit3,
  Eye,
  EyeOff,
  Heart,
  Mail,
  Phone,
  Save,
  Shield,
  ShoppingBag,
  Sparkles,
  Ticket,
  User,
  X,
} from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { sanitize, validateFullName, validatePhone } from '@/lib/validation';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/components/toast';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import { PhoneVerificationModal } from '@/components/phone-verification-modal';
import { Badge, Button } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfileStats {
  totalBookings: number;
  upcomingCount: number;
  completedCount: number;
  totalSpent: number;
}

interface Profile {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  role: string;
  createdAt: string;
  stats: ProfileStats;
}

/**
 * Mask an E.164 phone for display on screen.
 * Keeps the country-code prefix (caller is usually the user themselves, so
 * the country is not a secret) and the last 2 digits (enough to disambiguate
 * "is this the account I think it is?") and hides the middle.
 *
 *   +97455932567 → +974 •••••• 67
 *
 * Never logs the raw phone. Purely a display transform.
 */
function maskPhoneForDisplay(phone: string): string {
  if (!phone || phone.length < 6) return phone;
  const cc = phone.slice(0, 4);
  const mid = phone.slice(4, -2);
  const tail = phone.slice(-2);
  const dots = '•'.repeat(Math.min(mid.length, 6));
  return `${cc} ${dots} ${tail}`;
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  gold,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  gold?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle p-4 md:p-5 shadow-jadwal">
      <div
        className={cn(
          'inline-grid h-8 w-8 place-items-center rounded-lg mb-3',
          gold
            ? 'bg-jadwal-accent-soft text-jadwal-accent'
            : 'bg-sky-500/10 text-jadwal-primary',
        )}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <p className="font-display text-xl md:text-[22px] font-bold tracking-[-0.5px] text-jadwal-text leading-[1.1] tabular-nums">
        {value}
      </p>
      <p className="text-[11px] text-jadwal-text-muted mt-0.5 uppercase tracking-[0.4px] font-medium">
        {label}
      </p>
    </div>
  );
}

// ─── Field row ────────────────────────────────────────────────────────────────

function FieldRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-6 py-4 border-b border-jadwal-border-subtle last:border-0 flex items-start gap-4">
      <Icon
        className="w-4 h-4 text-jadwal-text-muted mt-0.5 shrink-0"
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-jadwal-text-muted uppercase tracking-[0.4px] mb-1">
          {label}
        </p>
        {children}
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-28 rounded-2xl bg-jadwal-surface-muted" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 rounded-2xl bg-jadwal-surface-muted"
          />
        ))}
      </div>
      <div className="h-72 rounded-2xl bg-jadwal-surface-muted" />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const { checkAuth } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    phone?: string;
  }>({});
  const [phoneVerifyOpen, setPhoneVerifyOpen] = useState(false);
  const [phoneRevealed, setPhoneRevealed] = useState(false);

  // Auto-re-hide phone after 30s even if the user leaves the tab open — cheap
  // defence against "walked away from an open profile tab" shoulder-surfing.
  useEffect(() => {
    if (!phoneRevealed) return;
    const id = setTimeout(() => setPhoneRevealed(false), 30_000);
    return () => clearTimeout(id);
  }, [phoneRevealed]);

  const { data: profile, isLoading, isError } = useQuery<Profile>({
    queryKey: ['profile'],
    queryFn: () => api.get('/users/profile').then((r) => r.data),
    staleTime: 60_000,
  });

  const { data: pointsData } = useQuery<{
    loyaltyPoints: number;
    qarPerPoint: number;
  }>({
    queryKey: ['user-points'],
    queryFn: () => api.get('/users/points').then((r) => r.data),
    staleTime: 60_000,
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { fullName?: string; phone?: string }) =>
      api.patch('/users/profile', payload).then((r) => r.data),
    onSuccess: async (updated) => {
      queryClient.setQueryData<Profile>(['profile'], (old) =>
        old
          ? { ...old, fullName: updated.fullName, phone: updated.phone }
          : old,
      );
      await checkAuth();
      setEditing(false);
      toast(t('profile.toast.updated'), 'success');
    },
    onError: () =>
      toast(t('profile.toast.updateFailed'), 'error'),
  });

  const startEdit = useCallback(() => {
    if (!profile) return;
    setFormName(profile.fullName);
    setFormPhone(profile.phone ?? '');
    setFieldErrors({});
    setEditing(true);
  }, [profile]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setFieldErrors({});
  }, []);

  const handleSave = useCallback(() => {
    const errors: { name?: string; phone?: string } = {};

    const nameResult = validateFullName(formName);
    if (!nameResult.valid) errors.name = nameResult.error;

    const phoneResult = validatePhone(formPhone.trim());
    if (!phoneResult.valid) errors.phone = phoneResult.error;

    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    const cleanName = sanitize(formName.trim());
    const cleanPhone = sanitize(formPhone.trim());
    const payload: { fullName?: string; phone?: string } = {};
    if (cleanName !== profile?.fullName) payload.fullName = cleanName;
    if (cleanPhone !== (profile?.phone ?? ''))
      payload.phone = cleanPhone || undefined;
    if (!Object.keys(payload).length) {
      setEditing(false);
      return;
    }
    updateMutation.mutate(payload);
  }, [formName, formPhone, profile, updateMutation]);

  const memberSince = profile
    ? new Date(profile.createdAt).toLocaleDateString(
        isRtl ? 'ar-EG' : 'en-US',
        { month: 'long', year: 'numeric' },
      )
    : '';

  const totalSpentFormatted = profile
    ? `QAR ${profile.stats.totalSpent.toFixed(2)}`
    : '';

  const initials = profile?.fullName
    ? profile.fullName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((n) => n.charAt(0).toUpperCase())
        .join('')
    : '';

  const worthQar =
    pointsData && pointsData.qarPerPoint > 0
      ? pointsData.loyaltyPoints * pointsData.qarPerPoint
      : 0;

  return (
    <div className="min-h-screen bg-jadwal-bg flex flex-col font-outfit">
      <Navbar variant="solid" />

      <main className="flex-1 pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          {/* Heading */}
          <div className="mb-6">
            <h1 className="font-display text-[26px] md:text-[34px] font-semibold tracking-[-0.8px] md:tracking-[-1px] text-jadwal-text leading-[1.15] m-0">
              {t('profile.title')}
            </h1>
            <p className="text-sm text-jadwal-text-muted mt-1">
              {t('profile.subtitle')}
            </p>
          </div>

          {/* Error */}
          {isError && !isLoading ? (
            <div className="rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle py-16 text-center">
              <p className="text-sm text-jadwal-text-muted">
                {t('profile.couldNotLoad')}
              </p>
              <Link
                href="/"
                className="text-xs text-jadwal-primary hover:underline mt-2 inline-block"
              >
                {t('common.backHome', { defaultValue: 'Back to home' })}
              </Link>
            </div>
          ) : null}

          {isLoading ? <ProfileSkeleton /> : null}

          {!isLoading && profile ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-5"
            >
              {/* Header card — avatar + name + verified badge + edit */}
              <div className="rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle p-5 md:p-7 shadow-jadwal flex items-center gap-4 md:gap-5 flex-col md:flex-row text-center md:text-start">
                <div className="w-[72px] h-[72px] md:w-[88px] md:h-[88px] rounded-full grid place-items-center text-white font-display font-semibold tracking-[-0.5px] text-[26px] md:text-[34px] shrink-0 bg-[linear-gradient(135deg,var(--jadwal-accent),var(--jadwal-primary))]">
                  {initials || <User className="w-8 h-8" aria-hidden="true" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap justify-center md:justify-start">
                    <h2 className="font-display text-[22px] md:text-[28px] font-semibold tracking-[-0.6px] text-jadwal-text leading-[1.2] m-0 truncate max-w-full">
                      {profile.fullName}
                    </h2>
                    {profile.emailVerified ? (
                      <Badge
                        variant="success"
                        size="sm"
                        icon={
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        }
                      >
                        {t('profile.verified')}
                      </Badge>
                    ) : (
                      <Badge variant="warning" size="sm">
                        {t('profile.notVerified')}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[13px] text-jadwal-text-muted mt-1 truncate">
                    {profile.email} · {t('profile.memberSince')} {memberSince}
                  </p>
                </div>
                {!editing ? (
                  <Button
                    variant="secondary"
                    onClick={startEdit}
                    icon={<Edit3 className="h-3.5 w-3.5" aria-hidden="true" />}
                    className="shrink-0"
                  >
                    {t('profile.edit')}
                  </Button>
                ) : null}
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                <StatCard
                  icon={ShoppingBag}
                  label={t('profile.totalBookings')}
                  value={profile.stats.totalBookings}
                />
                <StatCard
                  icon={Sparkles}
                  label={t('profile.upcoming')}
                  value={profile.stats.upcomingCount}
                />
                <StatCard
                  icon={CheckCircle2}
                  label={t('profile.completed')}
                  value={profile.stats.completedCount}
                />
                <StatCard
                  icon={DollarSign}
                  label={t('profile.totalSpent')}
                  value={totalSpentFormatted}
                  gold
                />
              </div>

              {/* Contact + Wanasa two-column */}
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-4 md:gap-5">
                {/* Contact info */}
                <div className="rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle shadow-jadwal overflow-hidden">
                  <div className="px-6 pt-5 pb-3 flex items-center justify-between gap-3">
                    <h3 className="font-display text-[16px] md:text-[18px] font-semibold tracking-[-0.3px] text-jadwal-text m-0">
                      {t('profile.contactInfo', {
                        defaultValue: 'Contact info',
                      })}
                    </h3>
                    {editing ? (
                      <div className="shrink-0 flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={cancelEdit}
                          icon={<X className="h-3.5 w-3.5" aria-hidden="true" />}
                        >
                          {t('common.cancel', { defaultValue: 'Cancel' })}
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleSave}
                          disabled={updateMutation.isPending}
                          loading={updateMutation.isPending}
                          icon={
                            !updateMutation.isPending ? (
                              <Save
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                            ) : undefined
                          }
                        >
                          {updateMutation.isPending
                            ? t('profile.saving')
                            : t('profile.save')}
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  <FieldRow icon={User} label={t('profile.fullName')}>
                    {editing ? (
                      <>
                        <input
                          value={formName}
                          onChange={(e) => {
                            setFormName(e.target.value);
                            setFieldErrors((p) => ({ ...p, name: undefined }));
                          }}
                          maxLength={100}
                          autoFocus
                          aria-invalid={!!fieldErrors.name}
                          className={cn(
                            'w-full px-3 py-2 rounded-xl border bg-jadwal-surface-muted text-sm text-jadwal-text focus:outline-none focus:ring-2 transition-shadow',
                            fieldErrors.name
                              ? 'border-jadwal-danger focus:ring-red-400/40'
                              : 'border-jadwal-border-subtle focus:ring-jadwal-primary/40',
                          )}
                        />
                        {fieldErrors.name ? (
                          <p className="text-xs text-jadwal-danger mt-1">
                            {fieldErrors.name}
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-sm font-medium text-jadwal-text">
                        {profile.fullName}
                      </p>
                    )}
                  </FieldRow>

                  <FieldRow icon={Mail} label={t('profile.email')}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-jadwal-text truncate">
                        {profile.email}
                      </p>
                      {profile.emailVerified ? (
                        <Badge
                          variant="success"
                          size="sm"
                          icon={
                            <CheckCircle2
                              className="h-3 w-3"
                              aria-hidden="true"
                            />
                          }
                        >
                          {t('profile.verified')}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-jadwal-text-muted mt-0.5">
                      {t('profile.emailCannotChange')}
                    </p>
                  </FieldRow>

                  <FieldRow icon={Phone} label={t('profile.phone')}>
                    {editing ? (
                      <>
                        <input
                          value={formPhone}
                          onChange={(e) => {
                            setFormPhone(e.target.value);
                            setFieldErrors((p) => ({ ...p, phone: undefined }));
                          }}
                          placeholder="+974 XXXX XXXX"
                          maxLength={25}
                          aria-invalid={!!fieldErrors.phone}
                          className={cn(
                            'w-full px-3 py-2 rounded-xl border bg-jadwal-surface-muted text-sm text-jadwal-text placeholder:text-jadwal-text-faint focus:outline-none focus:ring-2 transition-shadow',
                            fieldErrors.phone
                              ? 'border-jadwal-danger focus:ring-red-400/40'
                              : 'border-jadwal-border-subtle focus:ring-jadwal-primary/40',
                          )}
                        />
                        {fieldErrors.phone ? (
                          <p className="text-xs text-jadwal-danger mt-1">
                            {fieldErrors.phone}
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          className={cn(
                            'text-sm font-medium font-mono tabular-nums tracking-[1px]',
                            profile.phone
                              ? 'text-jadwal-text'
                              : 'text-jadwal-text-faint italic',
                          )}
                        >
                          {profile.phone
                            ? phoneRevealed
                              ? profile.phone
                              : maskPhoneForDisplay(profile.phone)
                            : t('profile.notSet')}
                        </p>
                        {profile.phone ? (
                          <button
                            type="button"
                            onClick={() => setPhoneRevealed((v) => !v)}
                            aria-label={
                              phoneRevealed
                                ? t('profile.hidePhone', {
                                    defaultValue: 'Hide phone number',
                                  })
                                : t('profile.showPhone', {
                                    defaultValue: 'Show phone number',
                                  })
                            }
                            aria-pressed={phoneRevealed}
                            className="p-1 rounded-md text-jadwal-text-muted hover:text-jadwal-text hover:bg-jadwal-surface-muted transition-colors"
                          >
                            {phoneRevealed ? (
                              <EyeOff
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                            ) : (
                              <Eye
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                            )}
                          </button>
                        ) : null}
                        {profile.phone && profile.phoneVerified ? (
                          <Badge
                            variant="success"
                            size="sm"
                            icon={
                              <CheckCircle2
                                className="h-3 w-3"
                                aria-hidden="true"
                              />
                            }
                          >
                            {t('profile.verified', {
                              defaultValue: 'Verified',
                            })}
                          </Badge>
                        ) : null}
                        {profile.phone && !profile.phoneVerified ? (
                          <>
                            <Badge
                              variant="warning"
                              size="sm"
                              icon={
                                <AlertCircle
                                  className="h-3 w-3"
                                  aria-hidden="true"
                                />
                              }
                            >
                              {t('profile.notVerified', {
                                defaultValue: 'Not verified',
                              })}
                            </Badge>
                            <button
                              type="button"
                              onClick={() => setPhoneVerifyOpen(true)}
                              className="text-xs font-semibold text-jadwal-primary hover:underline transition-colors"
                            >
                              {t('profile.verifyNow', {
                                defaultValue: 'Verify now',
                              })}
                            </button>
                          </>
                        ) : null}
                      </div>
                    )}
                  </FieldRow>

                  <FieldRow
                    icon={CalendarDays}
                    label={t('profile.memberSince')}
                  >
                    <p className="text-sm font-medium text-jadwal-text">
                      {memberSince}
                    </p>
                  </FieldRow>
                </div>

                {/* Wanasa gold gradient card */}
                <div className="relative overflow-hidden rounded-2xl p-5 md:p-6 text-white shadow-[0_12px_32px_-12px_rgba(181,136,32,0.4)] bg-[linear-gradient(135deg,var(--color-jadwal-gold-500)_0%,var(--color-jadwal-gold-700)_100%)]">
                  <div
                    aria-hidden="true"
                    className="absolute -top-8 -end-8 w-44 h-44 rounded-full border-2 border-white/15 pointer-events-none"
                  />
                  <div
                    aria-hidden="true"
                    className="absolute -bottom-16 -end-16 w-40 h-40 rounded-full border-2 border-white/10 pointer-events-none"
                  />
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="grid h-8 w-8 place-items-center rounded-lg bg-white/20">
                      <Coins className="h-4.5 w-4.5" aria-hidden="true" />
                    </div>
                    <span className="text-[12px] font-semibold uppercase tracking-[0.3px] opacity-95">
                      {t('loyalty.wanasaPoints', {
                        defaultValue: 'Wanasa points',
                      })}
                    </span>
                  </div>
                  <div className="text-[13px] opacity-90">
                    {t('loyalty.balance')}
                  </div>
                  <div className="font-display text-4xl font-bold tracking-[-1px] leading-none mt-0.5 tabular-nums">
                    {(pointsData?.loyaltyPoints ?? 0).toLocaleString()}
                  </div>
                  {worthQar > 0 ? (
                    <div className="text-[13px] opacity-90 mt-1.5 tabular-nums">
                      {t('loyalty.worth')} QAR {worthQar.toFixed(2)}
                    </div>
                  ) : (
                    <div className="text-[13px] opacity-80 mt-1.5">
                      {t('loyalty.earnToRedeem', {
                        defaultValue: 'Earn points on every booking.',
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Quick links */}
              <div className="rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle overflow-hidden">
                {[
                  {
                    icon: ShoppingBag,
                    href: '/bookings',
                    label: t('profile.viewBookings'),
                    sub: t('profile.bookingsCount', {
                      defaultValue: '{{n}} total',
                      n: profile.stats.totalBookings,
                    }),
                  },
                  {
                    icon: Heart,
                    href: '/likes',
                    label: t('nav.likedActivities', {
                      defaultValue: 'Liked activities',
                    }),
                    sub: null,
                  },
                  {
                    icon: Ticket,
                    href: '/offers',
                    label: t('nav.offers', { defaultValue: 'Offers' }),
                    sub: null,
                  },
                  {
                    icon: Shield,
                    href: '/account/change-password',
                    label: t('profile.changePassword', {
                      defaultValue: 'Change password',
                    }),
                    sub: null,
                  },
                ].map((link, i, arr) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      'flex items-center gap-3.5 px-5 py-4 hover:bg-jadwal-surface-muted transition-colors',
                      i < arr.length - 1 &&
                        'border-b border-jadwal-border-subtle',
                    )}
                  >
                    <div className="grid h-9 w-9 place-items-center rounded-xl bg-jadwal-surface-muted text-jadwal-text shrink-0">
                      <link.icon className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-jadwal-text">
                        {link.label}
                      </div>
                      {link.sub ? (
                        <div className="text-xs text-jadwal-text-muted mt-0.5">
                          {link.sub}
                        </div>
                      ) : null}
                    </div>
                    <ChevronRight
                      className={cn(
                        'h-4 w-4 text-jadwal-text-muted',
                        isRtl && 'rotate-180',
                      )}
                      aria-hidden="true"
                    />
                  </Link>
                ))}
              </div>
            </motion.div>
          ) : null}

          {/* W.127 — PDPL / GDPR self-service: download data + delete account.
              Sits at the bottom of /profile so it's discoverable but doesn't
              compete with the primary account-management actions above. */}
          <AccountDataControls />
        </div>
      </main>

      <Footer />

      {profile ? (
        <PhoneVerificationModal
          isOpen={phoneVerifyOpen}
          onClose={() => setPhoneVerifyOpen(false)}
          onVerified={() => {
            queryClient.invalidateQueries({ queryKey: ['profile'] });
            setPhoneVerifyOpen(false);
          }}
          initialPhone={profile.phone ?? ''}
          allowSkip={true}
        />
      ) : null}
    </div>
  );
}
