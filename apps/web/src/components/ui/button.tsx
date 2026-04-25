'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';
type Size = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  full?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  iconEnd?: ReactNode;
}

const variantClass: Record<Variant, string> = {
  primary:
    'bg-jadwal-primary text-jadwal-on-primary border border-jadwal-primary shadow-jadwal-primary hover:bg-jadwal-primary-hover hover:border-jadwal-primary-hover',
  secondary:
    'bg-transparent text-jadwal-text border border-jadwal-border-strong hover:bg-jadwal-surface-muted',
  ghost:
    'bg-transparent text-jadwal-text border border-transparent hover:bg-jadwal-surface-muted',
  danger:
    'bg-jadwal-danger text-white border border-jadwal-danger hover:opacity-90',
  gold: 'bg-jadwal-accent text-white border border-jadwal-accent shadow-jadwal-gold hover:opacity-95 dark:text-[#1e1304]',
};

const sizeClass: Record<Size, string> = {
  sm: 'h-[34px] px-[14px] text-[13px] rounded-[8px] gap-1.5',
  md: 'h-[42px] px-[18px] text-sm rounded-[10px] gap-2',
  lg: 'h-[52px] px-6 text-[15px] rounded-[12px] gap-2.5',
  xl: 'h-[60px] px-7 text-base rounded-[14px] gap-2.5',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    full,
    loading,
    icon,
    iconEnd,
    disabled,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-medium tracking-[-0.1px] whitespace-nowrap transition-[transform,box-shadow,background-color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jadwal-primary/40 disabled:opacity-50 disabled:cursor-not-allowed',
        variantClass[variant],
        sizeClass[size],
        full && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-[1em] w-[1em] animate-spin" aria-hidden="true" />
      ) : icon ? (
        <span className="inline-flex shrink-0 items-center">{icon}</span>
      ) : null}
      {children}
      {!loading && iconEnd ? (
        <span className="inline-flex shrink-0 items-center">{iconEnd}</span>
      ) : null}
    </button>
  );
});
