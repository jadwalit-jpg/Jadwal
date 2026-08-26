/**
 * `onIdle` gates 691 KB of third-party tracker JavaScript — 40% of all script
 * bytes on the mobile home page. If it ever fails to run its callback, the Meta
 * Pixel, GA4 and Clarity all silently stop loading and the business loses ad
 * attribution without a single error in the console. So the property under test
 * here is not "it defers" but "it ALWAYS eventually runs, exactly once".
 */
import { onIdle, onFirstInteraction } from '@/lib/defer-idle';

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

describe('onIdle — cancellation (the consent requirement)', () => {
  // Deferring opens a window in which the visitor can click "Decline" BEFORE
  // the tracker has been requested. Downloading 685 KB for someone who just
  // opted out would be indefensible, so this must genuinely abort.
  test('the disposer prevents the callback and reports that it did', () => {
    win.requestIdleCallback = jest.fn(() => 1) as IdleWin['requestIdleCallback'];
    const fn = jest.fn();

    const dispose = onIdle(fn, 3000);
    expect(dispose()).toBe(true); // true = the callback had NOT run

    window.dispatchEvent(new Event('load'));
    jest.advanceTimersByTime(10000); // ceiling must not resurrect it
    expect(fn).not.toHaveBeenCalled();
  });

  test('disposing AFTER the callback ran reports false and changes nothing', () => {
    // The caller uses this to decide between "cancel the download" and "the
    // script is already in flight, so revoke consent instead".
    win.requestIdleCallback = ((cb: () => void) => {
      cb();
      return 1;
    }) as IdleWin['requestIdleCallback'];
    const fn = jest.fn();

    const dispose = onIdle(fn);
    window.dispatchEvent(new Event('load'));
    expect(fn).toHaveBeenCalledTimes(1);

    expect(dispose()).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('cancelling before `load` stops the idle callback ever being scheduled', () => {
    const ric = jest.fn(() => 1) as IdleWin['requestIdleCallback'];
    win.requestIdleCallback = ric;
    const fn = jest.fn();

    const dispose = onIdle(fn);
    dispose();
    window.dispatchEvent(new Event('load'));

    expect(ric).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('onIdle — the first-paint gate', () => {
  /**
   * Measured 2026-08-25 on the live mobile home page: `load` fired early enough
   * that the browser went idle at ~1,508 ms while FCP did not land until
   * 1,958 ms, so 522 KB of tracker script began downloading BEFORE the first
   * paint and competed with the LCP image for bandwidth. These tests pin the
   * gate that closes that window — and, more importantly, pin that the gate can
   * never strand the callback (which would silently kill ad attribution).
   */
  type FakeObserver = {
    cb: (list: { getEntriesByName: (n: string) => unknown[] }) => void;
    observe: jest.Mock;
    disconnect: jest.Mock;
  };

  const realPO = global.PerformanceObserver;
  let instances: FakeObserver[] = [];

  /** Install a PerformanceObserver that reports `paint` support but never self-fires. */
  function installPaintObserver(): void {
    instances = [];
    class FakePO {
      cb: FakeObserver['cb'];
      observe = jest.fn();
      disconnect = jest.fn();
      constructor(cb: FakeObserver['cb']) {
        this.cb = cb;
        instances.push(this as unknown as FakeObserver);
      }
    }
    (FakePO as unknown as { supportedEntryTypes: string[] }).supportedEntryTypes = ['paint'];
    global.PerformanceObserver = FakePO as unknown as typeof PerformanceObserver;
  }

  /** Deliver an FCP entry to a pending observer. */
  function emitFcp(inst: FakeObserver): void {
    inst.cb({ getEntriesByName: (n: string) => (n === 'first-contentful-paint' ? [{}] : []) });
  }

  beforeEach(() => {
    installPaintObserver();
    win.requestIdleCallback = ((cb: () => void) => {
      cb();
      return 1;
    }) as IdleWin['requestIdleCallback'];
  });

  afterEach(() => {
    global.PerformanceObserver = realPO;
  });

  test('does NOT fire on `load` alone while the paint is still pending', () => {
    // This is the exact production bug: load -> idle -> download, all before FCP.
    const fn = jest.fn();

    onIdle(fn, 3000);
    window.dispatchEvent(new Event('load'));

    expect(instances).toHaveLength(1);
    expect(instances[0].observe).toHaveBeenCalledWith({ type: 'paint', buffered: true });
    expect(fn).not.toHaveBeenCalled();
  });

  test('fires once the first-contentful-paint entry arrives', () => {
    const fn = jest.fn();

    onIdle(fn, 3000);
    window.dispatchEvent(new Event('load'));
    expect(fn).not.toHaveBeenCalled();

    emitFcp(instances[0]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(instances[0].disconnect).toHaveBeenCalled();
  });

  test('a non-FCP paint entry does not release the gate', () => {
    // `paint` also carries first-paint; releasing on that would reopen the bug.
    const fn = jest.fn();

    onIdle(fn, 3000);
    window.dispatchEvent(new Event('load'));
    instances[0].cb({ getEntriesByName: () => [] });

    expect(fn).not.toHaveBeenCalled();
  });

  test('the ceiling STILL fires it when a paint never happens', () => {
    // Non-negotiable: a gate that can strand the callback would silently stop
    // the Meta Pixel, GA4 and Clarity from ever loading.
    const fn = jest.fn();

    onIdle(fn, 3000);
    window.dispatchEvent(new Event('load'));
    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('a late paint after the ceiling already ran does not double-run', () => {
    const fn = jest.fn();

    onIdle(fn, 3000);
    window.dispatchEvent(new Event('load'));
    jest.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(1);

    emitFcp(instances[0]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('disposing while awaiting paint disconnects the observer and prevents the run', () => {
    const fn = jest.fn();

    const dispose = onIdle(fn, 3000);
    window.dispatchEvent(new Event('load'));
    expect(dispose()).toBe(true);
    expect(instances[0].disconnect).toHaveBeenCalled();

    emitFcp(instances[0]);
    jest.advanceTimersByTime(10000);
    expect(fn).not.toHaveBeenCalled();
  });

  test('skips the gate entirely when FCP has already been recorded', () => {
    // jsdom's `performance` has no getEntriesByName at all — which is itself the
    // reason onIdle wraps the lookup in try/catch — so define it rather than spy.
    const perf = performance as unknown as Record<string, unknown>;
    const had = 'getEntriesByName' in perf;
    const original = perf.getEntriesByName;
    perf.getEntriesByName = () => [{}];
    const fn = jest.fn();

    try {
      onIdle(fn, 3000);
      window.dispatchEvent(new Event('load'));

      expect(instances).toHaveLength(0); // no observer created
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      if (had) perf.getEntriesByName = original;
      else delete perf.getEntriesByName;
    }
  });

  test('a throwing getEntriesByName does not strand the callback', () => {
    // The environment jsdom actually presents: the method is missing entirely.
    // The gate must still engage (and the ceiling still save it) rather than
    // letting the exception escape and kill the tracker load outright.
    const perf = performance as unknown as Record<string, unknown>;
    perf.getEntriesByName = () => {
      throw new Error('unsupported');
    };
    const fn = jest.fn();

    try {
      onIdle(fn, 3000);
      window.dispatchEvent(new Event('load'));
      expect(fn).not.toHaveBeenCalled(); // gate engaged, not bypassed

      jest.advanceTimersByTime(3000);
      expect(fn).toHaveBeenCalledTimes(1); // ceiling still guarantees the run
    } finally {
      delete perf.getEntriesByName;
    }
  });

  test('skips the gate where `paint` is not a supported entry type', () => {
    // jsdom and older Safari expose the constructor but never emit paint.
    (global.PerformanceObserver as unknown as { supportedEntryTypes: string[] }).supportedEntryTypes =
      ['mark', 'measure'];
    const fn = jest.fn();

    onIdle(fn, 3000);
    window.dispatchEvent(new Event('load'));

    expect(instances).toHaveLength(0);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('onFirstInteraction — Clarity only', () => {
  /**
   * Clarity's 176 ms task at 7,606 ms sat inside the TBT window and cost 126 ms
   * of Total Blocking Time. Gating it on interaction removes that entirely. The
   * property that matters most here is the INVERSE of onIdle's: this one must
   * NOT have a ceiling, or the cost comes straight back on every bounce.
   */
  const SETTLE = 500;

  /** Interact, then flush the settle window that follows it. */
  function interactAndSettle(type = 'scroll'): void {
    window.dispatchEvent(new Event(type));
    jest.advanceTimersByTime(SETTLE);
  }

  test('does not run on load, idle, or the passage of time', () => {
    const fn = jest.fn();

    onFirstInteraction(fn);
    window.dispatchEvent(new Event('load'));
    jest.advanceTimersByTime(60_000);

    expect(fn).not.toHaveBeenCalled();
  });

  test.each(['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'])(
    'runs on %s',
    (type) => {
      const fn = jest.fn();

      onFirstInteraction(fn);
      interactAndSettle(type);

      expect(fn).toHaveBeenCalledTimes(1);
    },
  );

  test('runs exactly once across several different interactions', () => {
    // Loading the recorder twice would start two sessions for one visitor.
    const fn = jest.fn();

    onFirstInteraction(fn);
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('keydown'));
    jest.advanceTimersByTime(SETTLE);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('the disposer prevents it and reports that it did', () => {
    // Same consent requirement as onIdle: a visitor who declines before ever
    // interacting must never have the session recorder requested.
    const fn = jest.fn();

    const dispose = onFirstInteraction(fn);
    expect(dispose()).toBe(true);

    interactAndSettle('scroll');
    interactAndSettle('pointerdown');
    expect(fn).not.toHaveBeenCalled();
  });

  test('disposing after it ran reports false and changes nothing', () => {
    const fn = jest.fn();

    const dispose = onFirstInteraction(fn);
    interactAndSettle();
    expect(fn).toHaveBeenCalledTimes(1);

    expect(dispose()).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('every listener is detached once it has run', () => {
    // A leaked scroll listener on every page view is its own perf regression.
    const remove = jest.spyOn(window, 'removeEventListener');
    const fn = jest.fn();

    onFirstInteraction(fn);
    interactAndSettle();

    for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll']) {
      expect(remove).toHaveBeenCalledWith(type, expect.any(Function));
    }
    remove.mockRestore();
  });
});

describe('onFirstInteraction — the settle window (a consent guard)', () => {
  /**
   * For most visitors the FIRST interaction is the click on the cookie banner,
   * and `pointerdown` reaches window before React runs that button's onClick.
   * Without a settle window, clicking "Decline" is itself what downloads the
   * session recorder — the precise outcome the deferral exists to prevent.
   */
  test('does not fire on the interaction itself', () => {
    const fn = jest.fn();

    onFirstInteraction(fn);
    window.dispatchEvent(new Event('pointerdown'));

    expect(fn).not.toHaveBeenCalled();
  });

  test('a decline landing inside the settle window still prevents it', () => {
    const fn = jest.fn();

    const dispose = onFirstInteraction(fn);
    window.dispatchEvent(new Event('pointerdown'));
    // React processes the click and the consent effect cancels, mid-window.
    expect(dispose()).toBe(true);

    jest.advanceTimersByTime(10_000);
    expect(fn).not.toHaveBeenCalled();
  });

  test('fires once the window elapses with no cancellation', () => {
    const fn = jest.fn();

    onFirstInteraction(fn);
    window.dispatchEvent(new Event('pointerdown'));

    jest.advanceTimersByTime(499);
    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('further interactions during the window do not stack extra runs', () => {
    const fn = jest.fn();

    onFirstInteraction(fn);
    window.dispatchEvent(new Event('pointerdown'));
    jest.advanceTimersByTime(200);
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('keydown'));
    jest.advanceTimersByTime(10_000);

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
