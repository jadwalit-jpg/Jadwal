import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Variant =
  | 'neutral'
  | 'primary'
  | 'gold'
  | 'success'
  | 'warning'
  | 'danger'
  | 'dark';
type Size = 'sm' | 'md';

export interface BadgeProps {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

const variantClass: Record<Variant, string> = {
  neutral:
    'bg-jadwal-surface-muted text-jadwal-text-muted border-jadwal-border-subtle',
  primary:
    'bg-sky-500/10 text-jadwal-primary border-sky-500/25 dark:bg-sky-400/10',
  gold: 'bg-jadwal-accent-soft text-jadwal-accent-text border-[rgba(181,136,32,0.25)]',
  success:
    'bg-emerald-500/10 text-jadwal-success border-emerald-500/25',
  warning:
    'bg-amber-500/10 text-jadwal-warning border-amber-500/25',
  danger: 'bg-red-500/10 text-jadwal-danger border-red-500/25',
  dark: 'bg-slate-900/85 text-white border-transparent dark:bg-black/50',
};

const sizeClass: Record<Size, string> = {
  sm: 'h-[22px] px-[7px] text-[11px] rounded-md gap-1',
  md: 'h-[26px] px-[10px] text-[12px] rounded-[7px] gap-1',
};

export function Badge({
  variant = 'neutral',
  size = 'md',
  icon,
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-semibold tracking-[-0.05px] border',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
    >
      {icon ? <span className="inline-flex shrink-0 items-center">{icon}</span> : null}
      {children}
    </span>
  );
}
