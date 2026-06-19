'use client';

import Image from 'next/image';
import { LocaleLink as Link } from '@/components/locale-link';
import {
  Crown,
  Feather,
  Landmark,
  type LucideIcon,
  Mountain,
  Palette,
  Ship,
  Users,
  Utensils,
  Waves,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const ICON_MAP: Record<string, LucideIcon> = {
  adventure: Mountain,
  culture: Landmark,
  family: Users,
  cruise: Ship,
  heritage: Feather,
  dining: Utensils,
  workshop: Palette,
  workshops: Palette,
  luxury: Crown,
  watersports: Waves,
  'water-sports': Waves,
};

export interface CategoryPillProps {
  label: string;
  slug: string;
  active?: boolean;
  icon?: LucideIcon;
  image?: string | null;
  href?: string;
  className?: string;
}

function pickIcon(slug: string): LucideIcon {
  return ICON_MAP[slug.toLowerCase()] ?? Landmark;
}

export function CategoryPill({
  label,
  slug,
  active,
  icon,
  image,
  href,
  className,
}: CategoryPillProps) {
  const Icon = icon ?? pickIcon(slug);
  const finalHref = href ?? `/explore?category=${encodeURIComponent(slug)}`;

  return (
    <Link
      href={finalHref}
      className={cn(
        'group flex flex-col items-center gap-2.5 min-w-[104px] sm:min-w-[128px] shrink-0 focus-visible:outline-none',
        className,
      )}
    >
      <div
        className={cn(
          'relative h-24 w-24 sm:h-[120px] sm:w-[120px] overflow-hidden rounded-full border transition-transform group-hover:-translate-y-0.5 group-focus-visible:-translate-y-0.5 group-focus-visible:ring-2 group-focus-visible:ring-jadwal-primary/40',
          active
            ? 'border-jadwal-primary shadow-jadwal-primary'
            : 'border-jadwal-border-subtle',
          !image &&
            (active
              ? 'bg-jadwal-primary text-jadwal-on-primary'
              : 'bg-jadwal-surface-muted text-jadwal-text'),
        )}
      >
        {image ? (
          <>
            <Image
              src={image}
              alt=""
              fill
              sizes="(max-width: 640px) 96px, 120px"
              loading="lazy"
              // Dev: skip optimizer — Next.js runs inside Docker and can't
              // reach the API at `localhost:4000` from the container.
              unoptimized={process.env.NODE_ENV !== 'production'}
              className="object-cover transition-transform duration-300 group-hover:scale-105"
            />
            {active ? (
              <span
                aria-hidden="true"
                className="absolute inset-0 ring-2 ring-jadwal-primary ring-offset-2 ring-offset-jadwal-bg rounded-full pointer-events-none"
              />
            ) : null}
          </>
        ) : (
          <span className="grid h-full w-full place-items-center">
            <Icon className="h-8 w-8 sm:h-10 sm:w-10" strokeWidth={1.7} aria-hidden="true" />
          </span>
        )}
      </div>
      <div className="text-center text-[13px] sm:text-[14px] font-medium tracking-[-0.1px] text-jadwal-text">
        {label}
      </div>
    </Link>
  );
}
