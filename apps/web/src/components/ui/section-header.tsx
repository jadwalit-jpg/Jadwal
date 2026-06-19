import { LocaleLink as Link } from '@/components/locale-link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SectionHeaderProps {
  title: string;
  seeAllHref?: string;
  seeAllLabel?: string;
  rtl?: boolean;
  className?: string;
}

export function SectionHeader({
  title,
  seeAllHref,
  seeAllLabel,
  rtl,
  className,
}: SectionHeaderProps) {
  const Chevron = rtl ? ChevronLeft : ChevronRight;
  return (
    <div className={cn('flex items-end justify-between mb-5', className)}>
      <h2 className="font-display text-[22px] sm:text-[26px] font-semibold tracking-[-0.6px] sm:tracking-[-0.8px] text-jadwal-text leading-[1.15] m-0">
        {title}
      </h2>
      {seeAllHref && seeAllLabel ? (
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
