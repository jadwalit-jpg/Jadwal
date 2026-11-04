'use client';

import Image from 'next/image';
import { LocaleLink as Link } from '@/components/locale-link';
import { Clock, Heart, MapPin } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { localized } from '@/lib/localize';
import { cn } from '@/lib/utils';
import { Badge } from './badge';
import { Rating } from './rating';

// Neutral soft-gradient blur-up placeholder shown while a card image loads —
// replaces the hard grey box with a gentle reveal. Generic (not per-image) so
// there is ZERO backend/fetch surface: a tiny (20×13) WebP, 66 bytes, inlined.
//
// 2026-11: the previous placeholder decoded to PURE BLACK (avg RGB 0,0,0), so a
// lazy card that had not loaded yet — e.g. just below the fold on
// /desert-safari-qatar — showed as a black box and read as a broken image.
// This one is a light sand→slate gradient (avg RGB 231,233,239).
export const CARD_IMG_BLUR =
  'data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAADwAgCdASoUAA0APrVKnkonJCKhsAgA4BaJaQDCgDDWAAD+8ciLBdFl+DaiAAAA';

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
  /** DAILY listings: check-in / check-out clock times ("14:00"), shown as the
   *  duration when `durationValue` is null (flexible night count). */
  checkInTime?: string | null;
  checkOutTime?: string | null;
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
  /**
   * Preload this card's image as an LCP candidate. Defaults to false (lazy).
   *
   * Only set it for cards the CALLER has measured to be above the fold —
   * preloading images nobody scrolls to competes for bandwidth with the ones
   * they do, which is the opposite of the intent.
   */
  preload?: boolean;
  /**
   * Fetch the image immediately (`loading="eager"`) without the preload hint.
   * For the first few cards of a page that is the ad landing page, so a
   * visitor who scrolls within a second or two never meets the placeholder.
   * Ignored when `preload` is set (preload already implies eager).
   */
  eager?: boolean;
  /**
   * Show how the price is charged next to it: per person, or a flat price for
   * the whole group/unit. Maps from the listing's `pricingModel`
   * (PER_PERSON / PER_UNIT). Omitted → price only (unchanged default).
   */
  priceUnit?: 'person' | 'group';
  /**
   * When set, renders a WhatsApp button next to "View" that opens this
   * pre-built wa.me link (new tab). Omitted → "View" only (unchanged default).
   */
  whatsappHref?: string;
  /**
   * DAILY listings with no fixed night count have no `durationValue`; with this
   * on, the card shows the listing's check-in – check-out window ("14:00 – 09:00")
   * in the duration slot instead of nothing. Omitted → unchanged default.
   */
  stayWindow?: boolean;
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
  checkInTime?: string | null,
  checkOutTime?: string | null,
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
  // DAILY with no fixed night count (flexible stay): show the listing's own
  // check-in → check-out window instead of nothing (e.g. "14:00 – 09:00").
  if (bookingType === 'DAILY' && checkInTime && checkOutTime) {
    return `${checkInTime} – ${checkOutTime}`;
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
  preload = false,
  eager = false,
  priceUnit,
  whatsappHref,
  stayWindow = false,
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
    // Opt-in only (landing pages) so other card lists are unchanged.
    stayWindow ? activity.checkInTime : undefined,
    stayWindow ? activity.checkOutTime : undefined,
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
              // Opt-in only: `preload` for the handful of cards a caller knows
              // are above the fold, lazy for everything else. Next 16 deprecates
              // `priority` in favour of `preload`, and the two are mutually
              // exclusive with `loading`, hence the spread.
              //
              // WHY IT MATTERS. On /desert-safari-qatar at 412x823 the first
              // card image IS the LCP element (75,600 px², larger than the h1),
              // and it sat at `loading="lazy"` with no preload — so all three of
              // Lighthouse's LCP-discovery checks failed. Same shape as the
              // /explore fix (#602).
              {...(preload
                ? ({ preload: true } as const)
                : eager
                  ? ({ loading: 'eager' } as const)
                  : ({ loading: 'lazy' } as const))}
              // In dev the API serves uploads from `http://localhost:4000/...`,
              // which the Next.js image optimizer (running *inside* the
              // `jadwal-web` container) cannot reach — localhost resolves to
              // the container itself. Bypass the proxy in dev only; in prod
              // the S3/CDN URLs are public and full AVIF/WebP negotiation
              // + responsive srcset run normally.
              unoptimized={process.env.NODE_ENV !== 'production'}
              placeholder="blur"
              blurDataURL={CARD_IMG_BLUR}
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
        <div className="mt-auto flex flex-col gap-2 pt-2">
          <div className="flex items-end justify-between gap-2">
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
                {priceUnit ? (
                  <span className="text-[12px] text-jadwal-text-muted">
                    {priceUnit === 'group'
                      ? t('activity.perGroup', { defaultValue: 'per group' })
                      : t('activity.perPerson', { defaultValue: 'per person' })}
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
          {/* View CTA — matches the solid-blue pill used on /explore so
              every list of cards (homepage Featured + Near You, /explore
              grid) shows the same affordance. `aria-label` includes the
              activity title because the same card already has TWO links
              to the same href (image + title); a third unlabeled "View"
              link would read as duplicate to screen-reader users. */}
          <div className={whatsappHref ? 'grid grid-cols-2 gap-2' : 'flex'}>
            <Link
              href={finalHref}
              aria-label={`${t('explore.view', { defaultValue: 'View' })} ${title}`}
              className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-all hover:bg-blue-700"
            >
              {t('explore.view', { defaultValue: 'View' })}
            </Link>
            {whatsappHref ? (
              // Opt-in (SEO landing pages): a WhatsApp enquiry pre-filled with
              // the listing name, same wa.me format as the floating button.
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${t('activity.whatsapp', { defaultValue: 'WhatsApp' })} · ${title}`}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#25D366] px-4 py-2 text-xs font-medium text-white transition-all hover:bg-[#1ebe5b]"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="h-3.5 w-3.5 fill-white shrink-0">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
                </svg>
                {t('activity.whatsapp', { defaultValue: 'WhatsApp' })}
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
