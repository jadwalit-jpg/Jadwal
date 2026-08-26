'use client';

/**
 * Enter/exit transitions for a conditionally-rendered element, without an
 * animation library.
 *
 * WHY THIS EXISTS. `<AnimatePresence>` was the only thing keeping
 * framer-motion in the ROOT LAYOUT, and the root layout is on every route —
 * so a cookie banner and a Terms prompt were pulling 120 KB (uncompressed) of
 * `motion-dom` + `framer-motion` into the critical chunk group of every single
 * page. Measured 2026-08-25 on the live mobile home page, Lighthouse
 * attributed 506 ms of bootup time to that chunk and reported 23 KB of its
 * 38 KB transfer as unused. Both components animate exactly one fade-and-slide,
 * which CSS does natively.
 *
 * THE PROBLEM IT SOLVES. CSS cannot transition an element that React has
 * already removed from the tree, which is the whole reason `AnimatePresence`
 * exists. So the element is kept mounted for the duration of its exit
 * transition and only then dropped:
 *
 *   show -> mounted immediately, `visible` flips true on the NEXT FRAME so the
 *           browser has a chance to paint the "from" state first (setting both
 *           in one commit produces no transition at all — the classic bug).
 *   hide -> `visible` flips false so the exit transition runs, and `mounted`
 *           goes false only after `durationMs`.
 *
 * The caller renders nothing while `mounted` is false and swaps Tailwind
 * classes on `visible`. Keep `durationMs` >= the CSS duration or the element
 * is yanked mid-transition.
 *
 * REDUCED MOTION is the caller's job (`motion-reduce:transition-none`). The
 * unmount delay still elapses, which is correct — it is a teardown timer, not
 * an animation.
 */

import { useEffect, useState } from 'react';

export interface MountTransition {
  /** Render nothing when false. Stays true through the exit transition. */
  mounted: boolean;
  /** Drives the "to" classes. False on the first painted frame and while exiting. */
  visible: boolean;
}

export function useMountTransition(show: boolean, durationMs: number): MountTransition {
  const [mounted, setMounted] = useState(show);
  const [visible, setVisible] = useState(show);

  useEffect(() => {
    if (show) {
      setMounted(true);
      // Two frames, not one. A single rAF can still land in the same paint as
      // the mount in some browsers, and the transition is then skipped because
      // the element never rendered in its "from" state.
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }

    setVisible(false);
    const timer = setTimeout(() => setMounted(false), durationMs);
    return () => clearTimeout(timer);
  }, [show, durationMs]);

  return { mounted, visible };
}
