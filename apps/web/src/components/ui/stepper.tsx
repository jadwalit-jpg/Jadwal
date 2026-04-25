'use client';

import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StepperProps {
  value: number;
  min?: number;
  max?: number;
  onChange?: (next: number) => void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}

export function Stepper({
  value,
  min = 0,
  max = 20,
  onChange,
  ariaLabel,
  className,
  disabled,
}: StepperProps) {
  const canDec = !disabled && value > min;
  const canInc = !disabled && value < max;

  return (
    <div
      className={cn('inline-flex items-center gap-3', className)}
      role="group"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        onClick={() => canDec && onChange?.(Math.max(min, value - 1))}
        disabled={!canDec}
        aria-label="Decrease"
        className="inline-grid h-[34px] w-[34px] place-items-center rounded-full border border-jadwal-border-strong text-jadwal-text disabled:opacity-40 disabled:cursor-not-allowed hover:bg-jadwal-surface-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jadwal-primary/40"
      >
        <Minus className="h-[14px] w-[14px]" aria-hidden="true" />
      </button>
      <div
        className="min-w-[24px] text-center text-base font-semibold text-jadwal-text tabular-nums"
        aria-live="polite"
      >
        {value}
      </div>
      <button
        type="button"
        onClick={() => canInc && onChange?.(Math.min(max, value + 1))}
        disabled={!canInc}
        aria-label="Increase"
        className="inline-grid h-[34px] w-[34px] place-items-center rounded-full border border-jadwal-border-strong text-jadwal-text disabled:opacity-40 disabled:cursor-not-allowed hover:bg-jadwal-surface-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jadwal-primary/40"
      >
        <Plus className="h-[14px] w-[14px]" aria-hidden="true" />
      </button>
    </div>
  );
}
