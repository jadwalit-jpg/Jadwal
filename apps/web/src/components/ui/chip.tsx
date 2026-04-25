'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Size = 'sm' | 'md';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  icon?: ReactNode;
  size?: Size;
}

const sizeClass: Record<Size, string> = {
  sm: 'h-[26px] px-[10px] text-[12px] rounded-[7px] gap-1.5',
  md: 'h-[32px] px-3 text-[13px] rounded-[8px] gap-1.5',
};

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { className, active, icon, size = 'md', children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center font-medium tracking-[-0.1px] whitespace-nowrap border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jadwal-primary/40',
        active
          ? 'bg-jadwal-primary text-jadwal-on-primary border-jadwal-primary'
          : 'bg-jadwal-surface-muted text-jadwal-text border-jadwal-border-subtle hover:border-jadwal-border-strong',
        sizeClass[size],
        className,
      )}
      {...rest}
    >
      {icon ? <span className="inline-flex shrink-0 items-center">{icon}</span> : null}
      {children}
    </button>
  );
});
