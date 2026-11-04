'use client';

import { useState } from 'react';
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
  /**
   * Render the value as an editable numeric input instead of static text, so
   * the number can be typed directly (e.g. "8" guests without eight taps).
   * The input is bound to the SAME `value` / `onChange` as the buttons and
   * clamps to the same `min` / `max`, so there is no second source of truth.
   * Off by default — existing usages are unaffected.
   */
  editable?: boolean;
}

/** Clamp a typed value into [min, max]; NaN/empty falls back to `fallback`. */
function clamp(raw: string, min: number, max: number, fallback: number): number {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function Stepper({
  value,
  min = 0,
  max = 20,
  onChange,
  ariaLabel,
  className,
  disabled,
  editable = false,
}: StepperProps) {
  const canDec = !disabled && value > min;
  const canInc = !disabled && value < max;

  // Draft text for the editable input. Kept as a string so the field can be
  // momentarily empty while the user retypes; it is committed (clamped) on
  // every valid keystroke and normalised on blur. Re-synced whenever `value`
  // changes from the outside (the +/− buttons, a parent clamp, hydration).
  const [draft, setDraft] = useState(String(value));
  // Adjust-state-during-render (React's recommended alternative to a syncing
  // effect): when `value` changes from outside, reset the draft in the same render.
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setDraft(String(value));
  }

  const commitDraft = (raw: string) => {
    setDraft(raw);
    if (raw === '') return; // let the user clear the field before retyping
    const next = clamp(raw, min, max, value);
    if (next !== value) onChange?.(next);
    // Typed outside the range → reflect the clamped value immediately.
    if (String(next) !== raw && /^[0-9]+$/.test(raw)) setDraft(String(next));
  };

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
      {editable ? (
        <input
          type="number"
          inputMode="numeric"
          pattern="[0-9]*"
          min={min}
          max={max}
          step={1}
          value={draft}
          disabled={disabled}
          aria-label={ariaLabel}
          onChange={(e) => commitDraft(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={() => setDraft(String(value))}
          onFocus={(e) => e.target.select()}
          className="h-[34px] w-[52px] rounded-lg border border-jadwal-border-strong bg-jadwal-surface text-center text-base font-semibold text-jadwal-text tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-jadwal-primary/40 disabled:opacity-40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      ) : (
        <div
          className="min-w-[24px] text-center text-base font-semibold text-jadwal-text tabular-nums"
          aria-live="polite"
        >
          {value}
        </div>
      )}
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
