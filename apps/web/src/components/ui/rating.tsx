import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

type Size = 'xs' | 'sm' | 'md' | 'lg';

export interface RatingProps {
  value: number;
  count?: number;
  size?: Size;
  dark?: boolean;
  className?: string;
}

const textSizeClass: Record<Size, string> = {
  xs: 'text-[11px]',
  sm: 'text-[12px]',
  md: 'text-[13px]',
  lg: 'text-[14px]',
};

const iconSizeClass: Record<Size, string> = {
  xs: 'h-3 w-3',
  sm: 'h-[13px] w-[13px]',
  md: 'h-[14px] w-[14px]',
  lg: 'h-[15px] w-[15px]',
};

export function Rating({
  value,
  count,
  size = 'md',
  dark,
  className,
}: RatingProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1',
        textSizeClass[size],
        dark ? 'text-white' : 'text-jadwal-text',
        className,
      )}
    >
      <Star
        className={cn(
          'shrink-0',
          iconSizeClass[size],
          dark
            ? 'fill-amber-400 text-amber-400'
            : 'fill-jadwal-accent text-jadwal-accent',
        )}
        aria-hidden="true"
      />
      <span className="font-semibold tabular-nums">{value.toFixed(1)}</span>
      {count != null ? (
        <span
          className={cn(
            'font-normal tabular-nums',
            dark ? 'text-white/75' : 'text-jadwal-text-muted',
          )}
        >
          ({count.toLocaleString()})
        </span>
      ) : null}
    </div>
  );
}
