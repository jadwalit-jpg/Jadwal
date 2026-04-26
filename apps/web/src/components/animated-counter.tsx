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
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { animate, useInView } from 'framer-motion';

type Props = {
  value: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
};

export function AnimatedCounter({ value, decimals = 0, suffix = '', prefix = '' }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const [display, setDisplay] = useState(decimals > 0 ? '0.0' : '0');

  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, value, {
      duration: 3,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(v.toFixed(decimals)),
    });
    return () => controls.stop();
  }, [inView, value, decimals]);

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
