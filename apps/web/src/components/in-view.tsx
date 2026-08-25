'use client';

/**
 * Renders `children` only once the placeholder scrolls near the viewport.
 *
 * Built for the home page's Featured row, which was the entire source of the
 * mobile CLS budget: a single 0.4885 shift caused by that row being removed and
 * re-added when the late-arriving geo country changed its query key. The row
 * sits ~1,394px down, below an 823px fold, so no non-scrolling visitor ever saw
 * it — and five fixes aimed at the shift itself (skeleton shape, reserving
 * height two ways, server-rendering, keepPreviousData) all returned exactly
 * 0.4885, unchanged.
 *
 * Not rendering it until it is approached removes the cause instead of the
 * symptom: nothing mounts, so nothing can be removed, so there is no shift —
 * and the query and hydration work stop competing with first paint.
 *
 * `placeholder` MUST be the same height as the real content, otherwise this
 * trades one layout shift for another when the swap happens.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

export function InView({
  children,
  placeholder,
  rootMargin = '300px 0px',
}: {
  children: ReactNode;
  placeholder: ReactNode;
  /** How early to start rendering, so the swap lands before it is on screen. */
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    // No IntersectionObserver (very old browsers) -> show immediately rather
    // than leave the section permanently missing.
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, rootMargin]);

  if (shown) return <>{children}</>;
  return <div ref={ref}>{placeholder}</div>;
}
