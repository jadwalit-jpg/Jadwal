'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Clock, Heart, MapPin } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { localized } from '@/lib/localize';
import { cn } from '@/lib/utils';
import { Badge } from './badge';
import { Rating } from './rating';

type Size = 'sm' | 'md' | 'lg' | 'fill';

export interface ActivityCardActivity {
  id: string;
  slug: string;
  titleEn: string;
  titleAr?: string | null;
  pricePerPerson: number;
  priceWas?: number | null;
  country?: { currencyCode: string } | null;
  city?: { nameEn?: string | null; nameAr?: string | null } | null;
  vendor?: {
    businessNameEn?: string | null;
    businessNameAr?: string | null;
  } | null;
  coverImage?: string | null;
  gallery?: string[];
  avgRating?: number | null;
  reviewCount?: number;
  /** Legacy: duration in minutes (hourly only) */
  durationMinutes?: number | null;
  /** Newer: duration value paired with `bookingType` (HOURLY → hours, DAILY → nights) */
  durationValue?: number | null;
  durationType?: string | null;
  bookingType?: string;
  pricingModel?: string;
  badge?: 'bestseller' | 'toprated' | 'new' | null;
  bookedToday?: number;
  capacity?: number;
}

export interface ActivityCardProps {
  activity: ActivityCardActivity;
  size?: Size;
  liked?: boolean;
  onToggleLike?: () => void;
  className?: string;
  href?: string;
}

const sizeClass: Record<Size, { w: string; img: string; title: string; price: string }> = {
  sm: { w: 'w-[220px]', img: 'h-[160px]', title: 'text-[14px]', price: 'text-[15px]' },
  md: { w: 'w-[290px]', img: 'h-[220px]', title: 'text-[15px]', price: 'text-[17px]' },
  lg: { w: 'w-[340px]', img: 'h-[260px]', title: 'text-[16px]', price: 'text-[18px]' },
  fill: { w: 'w-full', img: 'h-[200px]', title: 'text-[15px]', price: 'text-[17px]' },
};

function formatDuration(
  durationValue: number | null | undefined,
  durationMinutes: number | null | undefined,
  bookingType: string | undefined,
  lang: string,
): string | null {
  // Prefer explicit durationValue from API (HOURLY → hours, DAILY → nights)
  if (durationValue && durationValue > 0) {
    if (bookingType === 'DAILY') {
      if (lang === 'ar') return `${durationValue} ليلة`;
      return `${durationValue} night${durationValue > 1 ? 's' : ''}`;
    }
    if (lang === 'ar') return `${durationValue} ساعة`;
    return `${durationValue}h`;
  }
  // Legacy fallback: durationMinutes
  if (durationMinutes && durationMinutes > 0) {
    if (durationMinutes >= 60 && durationMinutes % 60 === 0) {
      const h = durationMinutes / 60;
      if (lang === 'ar') return `${h} ساعة`;
      return `${h}h`;
    }
    return `${durationMinutes}m`;
  }
  return null;
}

function formatMoney(amount: number, currency: string, lang: string): string {
  const n = amount.toLocaleString('en-US', {
    minimumFractionDigits: amount % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  });
  if (lang === 'ar') {
    const ar = currency === 'QAR' ? 'ر.ق' : currency === 'SAR' ? 'ر.س' : currency === 'AED' ? 'د.إ' : currency;
    return `${n} ${ar}`;
  }
  return `${currency} ${n}`;
}

export function ActivityCard({
  activity,
  size = 'md',
  liked,
  onToggleLike,
  className,
  href,
}: ActivityCardProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const sz = sizeClass[size];

  const title = useMemo(
    () => localized(activity, 'title') || activity.titleEn,
    [activity],
  );
  const city = useMemo(() => localized(activity.city, 'name'), [activity.city]);
  const vendor = useMemo(
    () => localized(activity.vendor, 'businessName'),
    [activity.vendor],
  );
  const img = activity.coverImage || activity.gallery?.[0] || '';
  const currency = activity.country?.currencyCode ?? 'QAR';
  const priceStr = formatMoney(activity.pricePerPerson, currency, lang);
  const wasStr = activity.priceWas
    ? formatMoney(activity.priceWas, currency, lang)
    : null;
  const duration = formatDuration(
    activity.durationValue,
    activity.durationMinutes,
    activity.bookingType,
    lang,
  );

  const badgeLabel = activity.badge
    ? t(`activity.badge.${activity.badge}`, {
        defaultValue:
          activity.badge === 'bestseller'
            ? 'Bestseller'
            : activity.badge === 'toprated'
              ? 'Top rated'
              : 'New',
      })
    : null;
  const badgeVariant =
    activity.badge === 'bestseller'
      ? 'dark'
      : activity.badge === 'toprated'
        ? 'gold'
        : 'primary';

  const finalHref = href ?? `/activity/${activity.slug}`;
  const fromLabel = t('activity.from', { defaultValue: 'from' });

  return (
    <article
      data-testid="activity-card"
      className={cn(
        'group shrink-0 flex flex-col overflow-hidden rounded-[20px] border border-jadwal-border-subtle bg-jadwal-surface shadow-jadwal transition-shadow hover:shadow-jadwal-lg',
        sz.w,
        className,
      )}
    >
      <div className={cn('relative overflow-hidden', sz.img)}>
        {/* `relative` on the Link (not just the outer div) — next/image fill
            requires the DIRECT parent of <Image> to be positioned. */}
        <Link href={finalHref} className="relative block h-full w-full" aria-label={title}>
          {img ? (
            <Image
              src={img}
              alt={title}
              fill
              sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 340px"
              loading="lazy"
              // In dev the API serves uploads from `http://localhost:4000/...`,
              // which the Next.js image optimizer (running *inside* the
              // `jadwal-web` container) cannot reach — localhost resolves to
              // the container itself. Bypass the proxy in dev only; in prod
              // the S3/CDN URLs are public and full AVIF/WebP negotiation
              // + responsive srcset run normally.
              unoptimized={process.env.NODE_ENV !== 'production'}
              className="object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-jadwal-surface-muted text-jadwal-text-faint">
              <MapPin className="h-8 w-8" aria-hidden="true" />
            </div>
          )}
        </Link>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.28)_0%,rgba(0,0,0,0)_40%,rgba(0,0,0,0)_60%,rgba(0,0,0,0.15)_100%)]"
        />
        {badgeLabel ? (
          <div className="absolute top-3 inset-s-3">
            <Badge variant={badgeVariant} size="sm">
              {badgeLabel}
            </Badge>
          </div>
        ) : null}
        {onToggleLike ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleLike();
            }}
            aria-label={liked ? t('activity.unlike', { defaultValue: 'Unlike' }) : t('activity.like', { defaultValue: 'Like' })}
            aria-pressed={liked}
            className="absolute top-2.5 inset-e-2.5 inline-grid h-9 w-9 place-items-center rounded-full bg-white/90 backdrop-blur-md transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jadwal-primary/40"
          >
            <Heart
              className={cn(
                'h-[18px] w-[18px]',
                liked ? 'fill-red-500 text-red-500' : 'text-slate-900',
              )}
              aria-hidden="true"
            />
          </button>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-[14px]">
        <div className="flex items-center gap-1.5 text-[12px] text-jadwal-text-muted">
          {city ? (
            <>
              <MapPin className="h-3 w-3" aria-hidden="true" />
              <span>{city}</span>
            </>
          ) : null}
          {duration ? (
            <>
              {city ? <span className="opacity-60">·</span> : null}
              <Clock className="h-3 w-3" aria-hidden="true" />
              <span>{duration}</span>
            </>
          ) : null}
        </div>
        <Link
          href={finalHref}
          className={cn(
            'line-clamp-2 font-semibold tracking-[-0.2px] leading-[1.3] text-balance text-jadwal-text hover:text-jadwal-primary transition-colors',
            sz.title,
          )}
        >
          {title}
        </Link>
        {vendor ? (
          <div className="text-[12px] text-jadwal-text-muted truncate">
            {vendor}
          </div>
        ) : null}
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div>
            <div className="text-[11px] text-jadwal-text-muted mb-0.5">{fromLabel}</div>
            <div className="flex items-baseline gap-1.5">
              <span
                className={cn(
                  'font-bold tracking-[-0.3px] text-jadwal-text tabular-nums',
                  sz.price,
                )}
              >
                {priceStr}
              </span>
              {wasStr ? (
                <span className="text-[12px] text-jadwal-text-muted line-through">
                  {wasStr}
                </span>
              ) : null}
            </div>
          </div>
          {activity.avgRating != null ? (
            <Rating
              value={activity.avgRating}
              count={activity.reviewCount}
              size="sm"
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}
