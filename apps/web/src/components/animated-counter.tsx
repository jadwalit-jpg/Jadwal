/**
 * Counts up from 0 to `value` when the element scrolls into view.
 *
 * Used by the home trust-metrics row ("50+ verified partners",
 * "4.8/5 average rating", "2,000+ bookings").
 *
 * `inline-block tabular-nums min-w-[Nch]` reserves the final value's
 * character width up-front — the surrounding flex-wrap row would
 * otherwise reflow as the digits widen during the count-up, which on
 * RTL mobile reads as a "shake". With the min-width reserved the box
 * is fixed and the digits center within it.
 *
 * Plain `IntersectionObserver` + `requestAnimationFrame` (no framer-motion
 * — this component is in the homepage hero chunk; pulling the animation
 * engine in for a number tween isn't worth it). Honors `prefers-reduced-
 * motion: reduce` by jumping straight to the final value.
 */
'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  value: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
};

const DURATION_MS = 3000;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function AnimatedCounter({ value, decimals = 0, suffix = '', prefix = '' }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(decimals > 0 ? '0.0' : '0');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let rafId = 0;
    let done = false;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || done) return;
        done = true;
        io.disconnect();
        if (reduce) {
          setDisplay(value.toFixed(decimals));
          return;
        }
        const start = performance.now();
        const tick = (now: number) => {
          const p = Math.min(1, (now - start) / DURATION_MS);
          setDisplay((value * easeOutCubic(p)).toFixed(decimals));
          if (p < 1) rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [value, decimals]);

  const finalChars = `${prefix}${value.toFixed(decimals)}${suffix}`.length;
  const widthClass =
    finalChars <= 2 ? 'min-w-[2ch]' :
    finalChars === 3 ? 'min-w-[3ch]' :
    finalChars === 4 ? 'min-w-[4ch]' :
    finalChars === 5 ? 'min-w-[5ch]' :
    finalChars === 6 ? 'min-w-[6ch]' :
    'min-w-[7ch]';

  return (
    <span ref={ref} className={`inline-block text-center tabular-nums ${widthClass}`}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}
