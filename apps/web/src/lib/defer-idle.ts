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
 */

/** Default ceiling, in ms, before the callback is forced to run. */
const DEFAULT_TIMEOUT = 3000;

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};

export function onIdle(fn: () => void, timeout: number = DEFAULT_TIMEOUT): void {
  if (typeof window === 'undefined') return;

  let ran = false;
  const run = (): void => {
    if (ran) return;
    ran = true;
    fn();
  };

  const schedule = (): void => {
    const ric = (window as IdleWindow).requestIdleCallback;
    // Safari < 16.4: no requestIdleCallback. A short timeout still yields the
    // main thread, which is the point — it just can't wait for true idle.
    if (typeof ric === 'function') ric(run, { timeout });
    else window.setTimeout(run, 200);
  };

  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });

  window.setTimeout(run, timeout);
}
