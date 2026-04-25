/**
 * Counts up from 0 to `value` when the element scrolls into view.
 *
 * Used by the home trust-metrics row ("50+ verified partners",
 * "4.8/5 average rating", "2,000+ bookings"). Extracted from
 * home-client.tsx so both the above-fold hero AND below-fold sections
 * can use it without crossing the home/below-fold dynamic import
 * boundary.
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
      duration: 2,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(v.toFixed(decimals)),
    });
    return () => controls.stop();
  }, [inView, value, decimals]);

  return (
    <span ref={ref}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}
