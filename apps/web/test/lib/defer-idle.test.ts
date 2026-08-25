/**
 * `onIdle` gates 691 KB of third-party tracker JavaScript — 40% of all script
 * bytes on the mobile home page. If it ever fails to run its callback, the Meta
 * Pixel, GA4 and Clarity all silently stop loading and the business loses ad
 * attribution without a single error in the console. So the property under test
 * here is not "it defers" but "it ALWAYS eventually runs, exactly once".
 */
import { onIdle } from '@/lib/defer-idle';

type IdleWin = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};

const win = window as IdleWin;
const originalRic = win.requestIdleCallback;

/** Force document.readyState, which jsdom reports as 'complete' by default. */
function setReadyState(state: DocumentReadyState): void {
  Object.defineProperty(document, 'readyState', {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  setReadyState('loading');
});

afterEach(() => {
  jest.useRealTimers();
  if (originalRic) win.requestIdleCallback = originalRic;
  else delete win.requestIdleCallback;
  setReadyState('complete');
});

describe('onIdle — always runs', () => {
  test('runs after `load`, via requestIdleCallback', () => {
    const ric = jest.fn((cb: () => void) => {
      cb();
      return 1;
    });
    win.requestIdleCallback = ric;
    const fn = jest.fn();

    onIdle(fn);
    expect(fn).not.toHaveBeenCalled(); // still "loading" — must NOT have fired

    window.dispatchEvent(new Event('load'));
    expect(ric).toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('runs immediately-scheduled when `load` ALREADY fired before the call', () => {
    // The realistic case for a client component that mounts late: waiting on a
    // `load` event that will never fire again would strand the tracker forever.
    setReadyState('complete');
    win.requestIdleCallback = ((cb: () => void) => {
      cb();
      return 1;
    }) as IdleWin['requestIdleCallback'];
    const fn = jest.fn();

    onIdle(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('the timeout ceiling fires it even if `load` NEVER happens', () => {
    // A stalled image or an open long-poll can hold `load` indefinitely.
    win.requestIdleCallback = jest.fn(() => 1) as IdleWin['requestIdleCallback'];
    const fn = jest.fn();

    onIdle(fn, 3000);
    jest.advanceTimersByTime(2999);
    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('falls back to a timer when requestIdleCallback is absent (Safari < 16.4)', () => {
    delete win.requestIdleCallback;
    const fn = jest.fn();

    onIdle(fn);
    window.dispatchEvent(new Event('load'));
    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('onIdle — runs exactly ONCE', () => {
  test('load + idle + the timeout ceiling all racing still yields one call', () => {
    // Double-loading fbevents/gtag would double-count every page_view, which is
    // the SEO team's headline number — worse than being slightly slow.
    win.requestIdleCallback = ((cb: () => void) => {
      cb();
      return 1;
    }) as IdleWin['requestIdleCallback'];
    const fn = jest.fn();

    onIdle(fn, 3000);
    window.dispatchEvent(new Event('load'));
    window.dispatchEvent(new Event('load')); // `once` — must not re-schedule
    jest.advanceTimersByTime(10000); // ceiling fires too

    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('a slow idle callback that lands AFTER the ceiling does not double-run', () => {
    let idleCb: (() => void) | undefined;
    win.requestIdleCallback = ((cb: () => void) => {
      idleCb = cb;
      return 1;
    }) as IdleWin['requestIdleCallback'];
    const fn = jest.fn();

    onIdle(fn, 3000);
    window.dispatchEvent(new Event('load'));
    jest.advanceTimersByTime(3000); // ceiling wins the race
    expect(fn).toHaveBeenCalledTimes(1);

    idleCb?.(); // browser finally goes idle, long after
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
