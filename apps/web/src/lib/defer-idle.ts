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
 * NOT BEFORE FIRST PAINT. Measured on the live mobile home page 2026-08-25
 * (Lighthouse 13.4.0, throttled): `load` fired early enough that the browser
 * went idle at ~1,508 ms while FCP did not land until 1,958 ms — so the tracker
 * downloads were starting BEFORE the first paint they were supposed to come
 * after, and 522 KB of third-party script competed for bandwidth with the LCP
 * image (LCP 4.8 s, scoring 30/100). Waiting for `load` is not the same as
 * waiting for a paint: a document whose subresources all resolve quickly can
 * fire `load` while the main thread still has not produced a frame.
 *
 * So idle work is additionally gated on the `first-contentful-paint` entry.
 * This is a bandwidth/LCP protection, NOT a TBT fix — the trackers' own long
 * tasks execute later, whenever the main thread frees up, and are unaffected
 * by when the download was requested.
 *
 * The gate is skipped entirely where paint timing is not observable (jsdom,
 * older Safari), falling back to the previous behaviour rather than stranding
 * the callback. The `timeout` ceiling still overrides it in every case, so the
 * "always eventually runs" property is preserved even if a paint never fires.
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

/**
 * Whether paint timing is actually observable here.
 *
 * Deliberately checks that the `paint` ENTRY TYPE is supported, not merely that
 * `PerformanceObserver` exists: jsdom (and any environment that stubs the API)
 * exposes the constructor but never emits a paint entry, so gating on existence
 * alone would strand every callback until the ceiling.
 */
function paintObservable(): boolean {
  return (
    typeof PerformanceObserver === 'function' &&
    Array.isArray(PerformanceObserver.supportedEntryTypes) &&
    PerformanceObserver.supportedEntryTypes.includes('paint')
  );
}

/** Whether FCP has already been recorded for this document. */
function alreadyPainted(): boolean {
  try {
    return performance.getEntriesByName('first-contentful-paint').length > 0;
  } catch {
    return false;
  }
}

export function onIdle(fn: () => void, timeout: number = DEFAULT_TIMEOUT): IdleDisposer {
  if (typeof window === 'undefined') return () => false;

  let ran = false;
  let cancelled = false;
  // Held so cleanup can disconnect a paint gate that never resolved.
  let observer: PerformanceObserver | undefined;
  // Both the ceiling and the Safari fallback land here so cleanup can drain
  // them without tracking each one in its own mutable slot.
  const timers: number[] = [];

  const cleanup = (): void => {
    window.removeEventListener('load', schedule);
    for (const t of timers) window.clearTimeout(t);
    observer?.disconnect();
    observer = undefined;
  };

  const run = (): void => {
    if (ran || cancelled) return;
    ran = true;
    cleanup();
    fn();
  };

  /**
   * Invoke `next` once the first contentful paint has happened — or straight
   * away where paint is not observable, which preserves the pre-existing
   * behaviour rather than deferring indefinitely.
   */
  function whenPainted(next: () => void): void {
    if (alreadyPainted() || !paintObservable()) {
      next();
      return;
    }
    try {
      observer = new PerformanceObserver((list) => {
        if (list.getEntriesByName('first-contentful-paint').length === 0) return;
        observer?.disconnect();
        observer = undefined;
        next();
      });
      // `buffered` so a paint that landed between the readyState check and here
      // is not missed — that race is the whole bug this gate exists to fix.
      observer.observe({ type: 'paint', buffered: true });
    } catch {
      observer = undefined;
      next();
    }
  }

  function scheduleIdle(): void {
    if (cancelled) return;
    const ric = (window as IdleWindow).requestIdleCallback;
    // Safari < 16.4: no requestIdleCallback. A short timeout still yields the
    // main thread, which is the point — it just can't wait for true idle.
    if (typeof ric === 'function') ric(run, { timeout });
    else timers.push(window.setTimeout(run, 200));
  }

  function schedule(): void {
    if (cancelled) return;
    whenPainted(scheduleIdle);
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

/**
 * Events that count as the visitor engaging with the page. `scroll` is included
 * deliberately: it is what almost every real visitor does first, so gating on
 * this set keeps coverage high while still excluding the load window entirely.
 */
const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;

/**
 * How long to wait AFTER the first interaction before actually running the
 * callback. See `onFirstInteraction` — this window is a consent requirement,
 * not a performance tweak.
 */
const SETTLE_MS = 500;

/**
 * Run a callback on the visitor's FIRST interaction — same disposer contract as
 * `onIdle`, but with NO timeout ceiling, so it genuinely never runs on a page
 * nobody touched.
 *
 * FOR SESSION REPLAY ONLY (Clarity). Measured 2026-08-25 on the live mobile
 * home page, `clarity.js` ran a 176 ms task at 7,606 ms — inside the TBT window
 * (FCP 1,958 ms -> TTI 11,312 ms) — costing 126 ms of Total Blocking Time.
 *
 * Why this is the safe tracker to move, and the others are not: Clarity records
 * behaviour, so a session with zero interaction has nothing to replay and
 * losing it costs nothing. An ANALYTICS or ADS tag is the opposite — its
 * pageview/conversion is exactly what a zero-interaction bounce needs to
 * report, so gating those on interaction would silently drop real attribution.
 * Do not reuse this for the Meta Pixel or the Google tag.
 *
 * WHY THE SETTLE WINDOW EXISTS. For a great many visitors the very FIRST
 * interaction is the click on the cookie banner itself, and `pointerdown`
 * reaches window before React has run that button's onClick. Firing the
 * callback synchronously would therefore download a session recorder for the
 * person who just clicked "Decline" — the exact outcome the deferral exists to
 * prevent. Waiting `SETTLE_MS` leaves the consent effect time to call the
 * disposer first. The same window covers navigating onto an excluded route
 * (checkout) with the click that ends the current page.
 *
 * TRADE-OFF, stated plainly: visitors who never scroll, tap, or type are no
 * longer recorded at all, and for everyone else the replay begins shortly after
 * their first interaction rather than at page load.
 */
export function onFirstInteraction(fn: () => void, settleMs: number = SETTLE_MS): IdleDisposer {
  if (typeof window === 'undefined') return () => false;

  let ran = false;
  let cancelled = false;
  let timer: number | undefined;

  const detach = (): void => {
    for (const type of INTERACTION_EVENTS) window.removeEventListener(type, onInteract);
  };

  const cleanup = (): void => {
    detach();
    if (timer !== undefined) window.clearTimeout(timer);
  };

  function onInteract(): void {
    if (ran || cancelled || timer !== undefined) return;
    // Stop listening immediately — the settle window below is the part that is
    // still cancellable, and re-entering here would restart it.
    detach();
    timer = window.setTimeout(() => {
      if (cancelled) return;
      ran = true;
      fn();
    }, settleMs);
  }

  for (const type of INTERACTION_EVENTS) {
    // `passive` so listening can never delay a scroll or tap; `once` so a
    // single fired event detaches itself even before cleanup drains the rest.
    window.addEventListener(type, onInteract, { passive: true, once: true });
  }

  return (): boolean => {
    const prevented = !ran;
    cancelled = true;
    cleanup();
    return prevented;
  };
}
