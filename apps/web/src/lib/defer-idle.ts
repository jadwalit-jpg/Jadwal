/**
 * Run a callback once the browser is idle, so third-party tracker downloads
 * stop competing with rendering.
 *
 * WHY. Measured on the live mobile home page (390x844, 4x CPU, Slow 4G): the
 * page parses 1,721 KB of JavaScript with tracking enabled and 1,030 KB with it
 * declined. 691 KB — 40% of all JS — is the Meta Pixel, the Google tag and
 * Clarity, and every byte of it was being fetched the instant React hydrated,
 * i.e. during the exact window Core Web Vitals measures. LCP (1.4s) and CLS (0)
 * were already fine; the score was bound by main-thread parse time.
 *
 * WHAT THIS DOES NOT DO. It does not delay any tracker's queueing stub, only
 * the remote <script> fetch. fbq, gtag and clarity all install a synchronous
 * stub that buffers calls (fbq.queue / window.dataLayer / clarity.q) and the
 * vendor script drains that buffer when it arrives — so `init`, `config`,
 * PageView and consent calls are all still made in their original order and
 * nothing is dropped. Deferring the stub as well WOULD drop them, because the
 * call sites are optional-chained (`window.fbq?.(...)`) and would no-op.
 *
 * GUARANTEED TO RUN. Three racing triggers, first one wins:
 *   1. `load` has already fired -> schedule idle work immediately,
 *   2. otherwise wait for `load`, then schedule idle work,
 *   3. an unconditional `timeout` ceiling, so a page that never completes
 *      loading (a stalled image, an open long-poll) still gets its trackers.
 * requestIdleCallback's own `timeout` is a fourth belt: it forces the callback
 * to run even if the main thread never goes idle. Safari before 16.4 has no
 * requestIdleCallback at all, hence the setTimeout fallback.
 *
 * CANCELLABLE, and this is a consent requirement rather than tidiness. The
 * deferral opens a window (up to `timeout`) in which the visitor can click
 * "Decline" BEFORE we have requested anything. Downloading 685 KB of tracker
 * for someone who just opted out would be indefensible, so the returned
 * disposer aborts a pending run. It reports whether it actually prevented the
 * callback, which lets a caller reset its "already loaded" latch and schedule
 * again later — the case that matters is Clarity, which is switched off when
 * the visitor navigates onto checkout and must come back on afterwards.
 */

/** Default ceiling, in ms, before the callback is forced to run. */
const DEFAULT_TIMEOUT = 3000;

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};

/** Cancels a pending run. Returns true if the callback had NOT yet run. */
export type IdleDisposer = () => boolean;

export function onIdle(fn: () => void, timeout: number = DEFAULT_TIMEOUT): IdleDisposer {
  if (typeof window === 'undefined') return () => false;

  let ran = false;
  let cancelled = false;
  // Both the ceiling and the Safari fallback land here so cleanup can drain
  // them without tracking each one in its own mutable slot.
  const timers: number[] = [];

  const cleanup = (): void => {
    window.removeEventListener('load', schedule);
    for (const t of timers) window.clearTimeout(t);
  };

  const run = (): void => {
    if (ran || cancelled) return;
    ran = true;
    cleanup();
    fn();
  };

  function schedule(): void {
    if (cancelled) return;
    const ric = (window as IdleWindow).requestIdleCallback;
    // Safari < 16.4: no requestIdleCallback. A short timeout still yields the
    // main thread, which is the point — it just can't wait for true idle.
    if (typeof ric === 'function') ric(run, { timeout });
    else timers.push(window.setTimeout(run, 200));
  }

  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });

  timers.push(window.setTimeout(run, timeout));

  return (): boolean => {
    const prevented = !ran;
    cancelled = true;
    cleanup();
    return prevented;
  };
}
