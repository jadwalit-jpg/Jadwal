import type { ReactNode } from 'react';
import { LocaleLink as Link } from '@/components/locale-link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SectionHeaderProps {
  title: string;
  seeAllHref?: string;
  seeAllLabel?: string;
  rtl?: boolean;
  className?: string;
  /** Custom right-side control (e.g. a "View all / Show less" toggle button).
   *  Takes precedence over the seeAll link when provided. */
  action?: ReactNode;
}

export function SectionHeader({
  title,
  seeAllHref,
  seeAllLabel,
  rtl,
  className,
  action,
}: SectionHeaderProps) {
  const Chevron = rtl ? ChevronLeft : ChevronRight;
  return (
    <div className={cn('flex items-end justify-between gap-3 mb-5', className)}>
      <h2 className="font-display text-[22px] sm:text-[26px] font-semibold tracking-[-0.6px] sm:tracking-[-0.8px] text-jadwal-text leading-[1.15] m-0">
        {title}
      </h2>
      {action ? (
        action
      ) : seeAllHref && seeAllLabel ? (
        <Link
          href={seeAllHref}
          className="inline-flex items-center gap-1 text-sm font-medium text-jadwal-primary hover:underline"
        >
          {seeAllLabel}
          <Chevron className="h-[14px] w-[14px]" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}
