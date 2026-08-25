/**
 * `InView` exists to remove a specific, measured bug: the home page's Featured
 * row was the ENTIRE mobile CLS budget — one 0.4885 shift, caused by the row
 * being removed and re-added when the late-arriving geo country changed its
 * query key. The row sits ~1,394px down, below an 823px fold, so no
 * non-scrolling visitor ever saw it.
 *
 * Five fixes aimed at the shift itself all returned exactly 0.4885, unchanged.
 * Not rendering the row until it is approached returned 0.0000.
 *
 * The two failure modes this guards are opposite and both severe:
 *   - never revealing  -> half the home page silently disappears
 *   - revealing early  -> the deferral does nothing and CLS comes back
 */
import { render, screen, act } from '@testing-library/react';
import { InView } from '@/components/in-view';

type IOCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

let callbacks: IOCallback[] = [];
let observed: Element[] = [];
let disconnected = 0;
let lastOptions: IntersectionObserverInit | undefined;

class MockIO {
  constructor(cb: IOCallback, opts?: IntersectionObserverInit) {
    callbacks.push(cb);
    lastOptions = opts;
  }
  observe(el: Element) { observed.push(el); }
  disconnect() { disconnected++; }
  unobserve() {}
  takeRecords() { return []; }
}

const realIO = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;

beforeEach(() => {
  callbacks = []; observed = []; disconnected = 0; lastOptions = undefined;
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = MockIO;
});

afterEach(() => {
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = realIO;
});

const setup = () =>
  render(<InView placeholder={<div>PLACEHOLDER</div>}><div>REAL CONTENT</div></InView>);

describe('InView defers until approached', () => {
  test('shows the placeholder, not the content, before intersecting', () => {
    setup();
    expect(screen.getByText('PLACEHOLDER')).toBeInTheDocument();
    expect(screen.queryByText('REAL CONTENT')).not.toBeInTheDocument();
  });

  test('observes an element and starts early via rootMargin', () => {
    setup();
    expect(observed).toHaveLength(1);
    // A 0 margin would reveal it only once already on screen — too late to
    // avoid the visitor seeing the placeholder swap.
    expect(lastOptions?.rootMargin).toBe('300px 0px');
  });
});

describe('InView reveals — the "half the page vanishes" guard', () => {
  test('swaps to the real content once intersecting', () => {
    setup();
    act(() => { callbacks[0]([{ isIntersecting: true }]); });
    expect(screen.getByText('REAL CONTENT')).toBeInTheDocument();
    expect(screen.queryByText('PLACEHOLDER')).not.toBeInTheDocument();
  });

  test('stops observing after revealing — it must never re-hide', () => {
    setup();
    act(() => { callbacks[0]([{ isIntersecting: true }]); });
    expect(disconnected).toBeGreaterThan(0);
    act(() => { callbacks[0]([{ isIntersecting: false }]); });
    expect(screen.getByText('REAL CONTENT')).toBeInTheDocument();
  });

  test('a non-intersecting entry does NOT reveal', () => {
    setup();
    act(() => { callbacks[0]([{ isIntersecting: false }]); });
    expect(screen.queryByText('REAL CONTENT')).not.toBeInTheDocument();
  });

  test('renders immediately when IntersectionObserver is unavailable', () => {
    // Old browsers must get the whole page, not a permanent skeleton.
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    setup();
    expect(screen.getByText('REAL CONTENT')).toBeInTheDocument();
  });
});
