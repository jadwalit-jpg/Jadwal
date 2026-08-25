/**
 * The regression this guards: deferring the tracker <script> must not stop it
 * from ever being appended, and must not delay the queueing stub.
 *
 * Both halves matter and they fail in opposite directions:
 *   - Defer too much (stub included) and every `fbq(...)` / `gtag(...)` call at
 *     the call sites no-ops, because they are all optional-chained. Tracking
 *     silently dies with no console error.
 *   - Defer nothing and we are back to 691 KB of third-party JS competing with
 *     first paint, which is what this change exists to fix.
 *
 * So each test asserts the stub exists IMMEDIATELY and the <script> appears
 * ONLY after idle.
 */
import { render, act } from '@testing-library/react';

const mockPathname = jest.fn(() => '/');
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/context/cookie-consent', () => ({
  useCookieConsent: () => ({ consent: null, hydrated: true, accept: jest.fn(), decline: jest.fn() }),
}));

jest.mock('@/lib/fb-pixel', () => ({ FB_PIXEL_ID: '1554481776310825' }));
jest.mock('@/lib/gtag', () => ({ GA4_MEASUREMENT_ID: 'G-TEST', GOOGLE_ADS_ID: 'AW-TEST' }));
jest.mock('@/lib/clarity', () => ({
  CLARITY_PROJECT_ID: 'y4xknitrzo',
  isClarityAllowedPath: () => true,
}));

// Imported statically, not via await import(): a dynamic import combined with
// jest.resetModules() hands the component a SECOND copy of React, and every
// hook then throws "Cannot read properties of null".
import MetaPixel from '@/components/meta-pixel';
import GoogleTag from '@/components/google-tag';
import Clarity from '@/components/clarity';

type W = Window & Record<string, unknown>;
const w = window as W;

function srcs(): string[] {
  return Array.from(document.head.querySelectorAll('script')).map((s) => s.src);
}

beforeEach(() => {
  jest.useFakeTimers();
  document.head.innerHTML = '';
  delete w.fbq;
  delete w._fbq;
  delete w.gtag;
  delete w.dataLayer;
  delete w.clarity;
});

afterEach(() => {
  jest.useRealTimers();
});

/** Push past onIdle's ceiling; jsdom has no requestIdleCallback. */
function flushIdle(): void {
  act(() => {
    jest.advanceTimersByTime(3000);
  });
}

describe('Meta Pixel', () => {
  test('stub is synchronous, fbevents.js only downloads after idle', () => {
    act(() => {
      render(<MetaPixel />);
    });

    // Stub must exist NOW — the PageView effect calls window.fbq?.() and would
    // silently no-op otherwise.
    expect(typeof w.fbq).toBe('function');
    expect(srcs().some((s) => s.includes('fbevents'))).toBe(false);

    flushIdle();
    expect(srcs().some((s) => s.includes('connect.facebook.net'))).toBe(true);
  });

  test('the PageView queued before the script arrives is not lost', () => {
    act(() => {
      render(<MetaPixel />);
    });

    // fbevents drains fbq.queue on arrival, so init + PageView must be sitting
    // in it while the download is still pending.
    const queue = (w.fbq as unknown as { queue: unknown[][] }).queue;
    const names = queue.map((c) => `${c[0]}:${c[1]}`);
    expect(names).toContain('init:1554481776310825');
    expect(names).toContain('track:PageView');
  });
});

describe('Google tag', () => {
  test('dataLayer is populated synchronously, gtag.js downloads after idle', () => {
    act(() => {
      render(<GoogleTag />);
    });

    expect(typeof w.gtag).toBe('function');
    expect(srcs().some((s) => s.includes('googletagmanager'))).toBe(false);

    // gtag.js replays whatever is already on dataLayer, so both destinations
    // must be configured before the download completes.
    const pushed = (w.dataLayer as IArguments[]).map((a) => Array.from(a).join(':'));
    expect(pushed.some((p) => p.startsWith('config:AW-TEST'))).toBe(true);
    expect(pushed.some((p) => p.startsWith('config:G-TEST'))).toBe(true);

    flushIdle();
    expect(srcs().some((s) => s.includes('googletagmanager.com/gtag/js'))).toBe(true);
  });
});

describe('Clarity', () => {
  test('stub is synchronous, the tag downloads after idle', () => {
    act(() => {
      render(<Clarity />);
    });

    expect(typeof w.clarity).toBe('function');
    expect(srcs().some((s) => s.includes('clarity.ms'))).toBe(false);

    // The component calls clarity('consent') right after load; it must be
    // buffered in clarity.q for the tag to replay.
    const q = (w.clarity as unknown as { q: unknown[][] }).q;
    expect(q.some((c) => c[0] === 'consent')).toBe(true);

    flushIdle();
    expect(srcs().some((s) => s.includes('clarity.ms/tag/y4xknitrzo'))).toBe(true);
  });
});
