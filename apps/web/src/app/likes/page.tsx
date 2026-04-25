'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Heart, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/auth-context';
import { localized } from '@/lib/localize';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import { Button, Skeleton } from '@/components/ui';

interface LikedActivity {
  id: string;
  titleEn: string;
  titleAr: string | null;
  slug: string;
  coverImage: string | null;
  pricePerPerson: number;
  pricingModel: string;
  city: { nameEn: string; nameAr: string | null } | null;
  country: { currencyCode: string; nameEn: string; nameAr: string | null } | null;
  _count: { reviews: number };
}

function LikedCardSkeleton() {
  return (
    <div className="flex items-center gap-4 p-4 rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle">
      <Skeleton className="w-20 h-20 rounded-xl shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

export default function LikedActivitiesPage() {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  // Redirect to login if not authenticated
  if (!authLoading && !user) {
    router.push('/login?callbackUrl=/likes');
    return null;
  }

  const { data: activities, isLoading, isError } = useQuery<LikedActivity[]>({
    queryKey: ['my-likes'],
    queryFn: () => api.get('/customer/likes').then((r) => r.data),
    enabled: !!user && user.role === 'CUSTOMER',
    staleTime: 30_000,
  });

  const Chevron = isRtl ? ChevronLeft : ChevronRight;

  return (
    <div className="min-h-screen bg-jadwal-bg flex flex-col font-outfit">
      <Navbar variant="solid" />

      <main className="flex-1 pt-24 pb-16">
        <div className="max-w-2xl mx-auto px-4 sm:px-6">
          {/* Header */}
          <div className="mb-6">
            <h1 className="font-display text-[26px] md:text-[34px] font-semibold tracking-[-0.8px] md:tracking-[-1px] text-jadwal-text leading-[1.15] m-0">
              {t('likes.title')}
            </h1>
            <p className="text-sm text-jadwal-text-muted mt-1">
              {activities && activities.length > 0
                ? t('likes.count', {
                    defaultValue: '{{n}} activities',
                    n: activities.length,
                  })
                : t('likes.subtitle')}
            </p>
          </div>

          {/* Loading */}
          {isLoading || authLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <LikedCardSkeleton key={i} />
              ))}
            </div>
          ) : null}

          {/* Error */}
          {isError && !isLoading ? (
            <div className="rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle py-16 text-center">
              <p className="text-sm text-jadwal-text-muted">
                {t('common.error')}
              </p>
            </div>
          ) : null}

          {/* Empty */}
          {!isLoading && !authLoading && activities && activities.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle py-16 text-center"
            >
              <div className="w-[72px] h-[72px] mx-auto mb-4 rounded-2xl bg-red-500/10 grid place-items-center">
                <Heart
                  className="w-8 h-8 text-jadwal-danger"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              </div>
              <p className="text-base font-semibold text-jadwal-text">
                {t('likes.empty')}
              </p>
              <p className="text-sm text-jadwal-text-muted mt-1 mb-6 max-w-xs mx-auto">
                {t('likes.emptyDesc')}
              </p>
              <Button onClick={() => router.push('/explore')}>
                {t('likes.explore')}
              </Button>
            </motion.div>
          ) : null}

          {/* Activity list */}
          {!isLoading && activities && activities.length > 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-3"
            >
              {activities.map((activity, i) => {
                const currency = activity.country?.currencyCode ?? 'QAR';
                const title = localized(activity, 'title');
                const cityName = localized(activity.city, 'name');

                return (
                  <motion.div
                    key={activity.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.04, 0.4) }}
                  >
                    <Link
                      href={`/activity/${activity.slug}`}
                      className="group flex items-center gap-4 p-3 rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle shadow-jadwal hover:shadow-jadwal-lg hover:border-jadwal-border-strong transition-[box-shadow,border-color]"
                    >
                      <div className="w-20 h-20 rounded-xl bg-jadwal-surface-muted overflow-hidden shrink-0 relative">
                        {activity.coverImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={activity.coverImage}
                            alt={title}
                            width={80}
                            height={80}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          />
                        ) : (
                          <div className="w-full h-full grid place-items-center">
                            <Heart
                              className="w-6 h-6 text-jadwal-text-faint"
                              aria-hidden="true"
                            />
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-jadwal-text truncate group-hover:text-jadwal-primary transition-colors">
                          {title}
                        </p>
                        {cityName ? (
                          <p className="text-xs text-jadwal-text-muted mt-0.5 flex items-center gap-1">
                            <MapPin
                              className="w-3 h-3 shrink-0"
                              aria-hidden="true"
                            />
                            <span className="truncate">{cityName}</span>
                          </p>
                        ) : null}
                        <p className="text-xs font-bold text-jadwal-text mt-1.5 tabular-nums">
                          {currency} {Number(activity.pricePerPerson).toFixed(0)}
                          <span className="font-normal text-jadwal-text-muted ms-1">
                            /{' '}
                            {activity.pricingModel === 'PER_PERSON'
                              ? t('activity.person')
                              : t('activity.day')}
                          </span>
                        </p>
                      </div>

                      <Chevron
                        className={cn(
                          'w-4 h-4 shrink-0 transition-colors text-jadwal-text-faint group-hover:text-jadwal-primary',
                        )}
                        aria-hidden="true"
                      />
                    </Link>
                  </motion.div>
                );
              })}
            </motion.div>
          ) : null}
        </div>
      </main>

      <Footer />
    </div>
  );
}
