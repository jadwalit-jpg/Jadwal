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
 * ONLY after its release trigger.
 *
 * The trigger is NOT the same for all three (changed 2026-08-26). The Meta
 * Pixel and the Google tag are released by idle; Clarity is released by the
 * visitor's first interaction, because its 176 ms task was landing inside the
 * TBT window and a session recorder has nothing to record before then. Anything
 * asserting "after idle" for Clarity is asserting the old behaviour.
 */
import { render, act } from '@testing-library/react';

const mockPathname = jest.fn(() => '/');
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useSearchParams: () => new URLSearchParams(),
}));

let mockConsent: 'accepted' | 'declined' | null = null;
jest.mock('@/context/cookie-consent', () => ({
  useCookieConsent: () => ({
    consent: mockConsent,
    hydrated: true,
    accept: jest.fn(),
    decline: jest.fn(),
  }),
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

/**
 * Exact origin + path matching, deliberately NOT `src.includes('facebook.net')`.
 * A substring test passes for `https://evil-connect.facebook.net.attacker.com`,
 * so it would happily green-light a script loaded from the wrong host — CodeQL
 * flags that pattern (js/incomplete-url-substring-sanitization) and it is right
 * to. Parsing the URL asserts what we actually mean: this exact origin, and for
 * the tag scripts this exact path.
 */
function hasScript(origin: string, pathname?: string): boolean {
  return Array.from(document.head.querySelectorAll('script'))
    .filter((el) => el.src)
    .map((el) => new URL(el.src))
    .some((u) => u.origin === origin && (pathname === undefined || u.pathname === pathname));
}

const FB = 'https://connect.facebook.net';
const GTM = 'https://www.googletagmanager.com';
const CLARITY = 'https://www.clarity.ms';

beforeEach(() => {
  jest.useFakeTimers();
  mockConsent = null;
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

/** Clarity waits on the visitor doing something, so idle will never release it. */
function interact(): void {
  act(() => {
    window.dispatchEvent(new Event('scroll'));
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
    expect(hasScript(FB, '/en_US/fbevents.js')).toBe(false);

    flushIdle();
    expect(hasScript(FB, '/en_US/fbevents.js')).toBe(true);
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
    expect(hasScript(GTM, '/gtag/js')).toBe(false);

    // gtag.js replays whatever is already on dataLayer, so both destinations
    // must be configured before the download completes.
    const pushed = (w.dataLayer as IArguments[]).map((a) => Array.from(a).join(':'));
    expect(pushed.some((p) => p.startsWith('config:AW-TEST'))).toBe(true);
    expect(pushed.some((p) => p.startsWith('config:G-TEST'))).toBe(true);

    flushIdle();
    expect(hasScript(GTM, '/gtag/js')).toBe(true);
  });
});

describe('Clarity', () => {
  // Clarity alone waits for INTERACTION, not idle (2026-08-26). Measured on the
  // live mobile home page, the idle-scheduled tag ran a 176 ms task at 7,606 ms
  // — inside the TBT window — for 126 ms of Total Blocking Time. A session
  // recorder has nothing to record until the visitor acts, so that wait costs
  // no data. The Pixel and the Google tag must NOT copy this: reporting the
  // zero-interaction bounce is exactly their job.
  test('stub is synchronous and the consent call is buffered', () => {
    act(() => {
      render(<Clarity />);
    });

    expect(typeof w.clarity).toBe('function');
    expect(hasScript(CLARITY, '/tag/y4xknitrzo')).toBe(false);

    // The component calls clarity('consent') right after load; it must be
    // buffered in clarity.q for the tag to replay.
    const q = (w.clarity as unknown as { q: unknown[][] }).q;
    expect(q.some((c) => c[0] === 'consent')).toBe(true);
  });

  test('idle alone does NOT download the tag', () => {
    // The whole point of the change — if this ever goes green-by-idle again,
    // the 126 ms is back.
    act(() => {
      render(<Clarity />);
    });

    flushIdle();
    expect(hasScript(CLARITY, '/tag/y4xknitrzo')).toBe(false);
  });

  test('the tag downloads on the first interaction', () => {
    act(() => {
      render(<Clarity />);
    });
    expect(hasScript(CLARITY, '/tag/y4xknitrzo')).toBe(false);

    interact();
    expect(hasScript(CLARITY, '/tag/y4xknitrzo')).toBe(true);
  });
});

describe('declining during the deferral window', () => {
  // The regression this locks down: deferring the download means a visitor can
  // opt out BEFORE we have requested anything. In that window the right
  // behaviour is to never fetch the tracker at all — not to fetch it and then
  // ask the vendor to ignore it.
  // Each tracker is released by a DIFFERENT trigger, so the release must be
  // parameterised too. Flushing idle at Clarity would make this test pass
  // whether or not the decline worked — a guard that cannot fail is not a guard.
  test.each([
    ['Meta Pixel', () => <MetaPixel />, FB, '/en_US/fbevents.js', flushIdle],
    ['Google tag', () => <GoogleTag />, GTM, '/gtag/js', flushIdle],
    ['Clarity', () => <Clarity />, CLARITY, '/tag/y4xknitrzo', interact],
  ])('%s: no script is EVER appended', (_label, renderTracker, origin, path, release) => {
    const { rerender } = render(renderTracker());
    expect(hasScript(origin, path)).toBe(false); // still deferred

    // Visitor clicks Decline before the trigger that would release the download.
    mockConsent = 'declined';
    act(() => {
      rerender(renderTracker());
    });
    release();

    expect(hasScript(origin, path)).toBe(false);
  });
});
