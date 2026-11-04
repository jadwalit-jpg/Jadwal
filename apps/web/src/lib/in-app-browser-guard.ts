/**
 * Silence one harmless error from the Android Facebook in-app browser.
 *
 * Sessions opened inside the Facebook app on Android log
 *   "Error invoking postMessage: Java object is gone"
 * (seen in Clarity's JavaScript-errors panel). It is thrown by the WebView when
 * a script calls postMessage on the Facebook app's injected Java bridge after
 * the app has already torn that bridge down — typically a third-party tag
 * (Meta Pixel / gtag / Clarity all use postMessage) firing while the in-app
 * browser is closing or backgrounding. The page itself is unaffected; the
 * error is pure noise in error reporting.
 *
 * What this does (no functional change):
 *   1. Wraps window.postMessage so a call that throws THIS error returns
 *      quietly; every other error is re-thrown untouched.
 *   2. Registers capture-phase `error` / `unhandledrejection` listeners that
 *      stop THIS error only, so it neither reaches the console as uncaught nor
 *      the analytics error hooks registered after it.
 *
 * Installed at module load from <InAppBrowserGuard/> in the root layout, i.e.
 * during hydration — before the consent-gated tags are injected from effects.
 * Idempotent.
 */

const JAVA_OBJECT_GONE = /java object is gone/i;

/** True when `e` (an Error, a message string, or anything) is the IAB bridge error. */
export function isJavaObjectGoneError(e: unknown): boolean {
  if (!e) return false;
  if (typeof e === 'string') return JAVA_OBJECT_GONE.test(e);
  if (typeof e === 'object' && 'message' in e) {
    const msg = (e as { message?: unknown }).message;
    return typeof msg === 'string' && JAVA_OBJECT_GONE.test(msg);
  }
  return false;
}

type GuardedWindow = Window & { __jadwalIabGuard?: boolean };

export function installInAppBrowserGuard(win: Window | undefined = typeof window === 'undefined' ? undefined : window): void {
  if (!win) return;
  const w = win as GuardedWindow;
  if (w.__jadwalIabGuard) return;
  w.__jadwalIabGuard = true;

  // 1) window.postMessage
  const original = w.postMessage;
  if (typeof original === 'function') {
    const guarded = function (this: Window, ...args: unknown[]) {
      try {
        return (original as (...a: unknown[]) => void).apply(this ?? w, args);
      } catch (err) {
        if (isJavaObjectGoneError(err)) return undefined;
        throw err;
      }
    };
    try {
      w.postMessage = guarded as Window['postMessage'];
    } catch {
      /* non-writable in some embedded browsers — the listeners below still apply */
    }
  }

  // 2) Escaped errors of exactly this kind (thrown from other bridge objects).
  w.addEventListener(
    'error',
    (ev: ErrorEvent) => {
      if (isJavaObjectGoneError(ev.error) || isJavaObjectGoneError(ev.message)) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }
    },
    true,
  );
  w.addEventListener(
    'unhandledrejection',
    (ev: PromiseRejectionEvent) => {
      if (isJavaObjectGoneError(ev.reason)) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }
    },
    true,
  );
}
