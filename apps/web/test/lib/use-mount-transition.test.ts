/**
 * `useMountTransition` replaced framer-motion's <AnimatePresence> in the two
 * components the ROOT LAYOUT renders, which is what was dragging 120 KB of
 * motion-dom + framer-motion into the critical chunk group of every route.
 *
 * The property under test is the one AnimatePresence existed to provide: an
 * element must stay MOUNTED for the whole exit transition and disappear only
 * afterwards. Get that wrong and the cookie banner vanishes instantly instead
 * of sliding away — the regression would be purely visual and easy to miss.
 */
import { renderHook, act } from '@testing-library/react';
import { useMountTransition } from '@/lib/use-mount-transition';

const DURATION = 300;

/** Advance past both requestAnimationFrame hops that gate the enter state. */
function flushFrames(): void {
  act(() => {
    jest.advanceTimersByTime(32);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useMountTransition — entering', () => {
  test('hidden means not mounted at all', () => {
    const { result } = renderHook(() => useMountTransition(false, DURATION));

    expect(result.current.mounted).toBe(false);
    expect(result.current.visible).toBe(false);
  });

  test('shown from the very first render skips the animation', () => {
    // Deliberate: an element that is meant to be on screen at first paint
    // should not slide in every time the page loads.
    const { result } = renderHook(() => useMountTransition(true, DURATION));

    expect(result.current.mounted).toBe(true);
    expect(result.current.visible).toBe(true);
  });

  test('flipping to shown mounts FIRST and only then becomes visible', () => {
    // The ordering is the whole trick: committing both in one render gives the
    // browser no "from" state to transition out of, so nothing animates.
    const { result, rerender } = renderHook(({ s }) => useMountTransition(s, DURATION), {
      initialProps: { s: false },
    });

    act(() => {
      rerender({ s: true });
    });
    expect(result.current.mounted).toBe(true);
    expect(result.current.visible).toBe(false); // painted in the "from" state

    flushFrames();
    expect(result.current.visible).toBe(true);
  });
});

describe('useMountTransition — exiting', () => {
  test('stays mounted for the full duration, then unmounts', () => {
    const { result, rerender } = renderHook(({ s }) => useMountTransition(s, DURATION), {
      initialProps: { s: true },
    });
    flushFrames();

    act(() => {
      rerender({ s: false });
    });
    // Exit transition running: invisible but STILL in the DOM.
    expect(result.current.visible).toBe(false);
    expect(result.current.mounted).toBe(true);

    act(() => {
      jest.advanceTimersByTime(DURATION - 1);
    });
    expect(result.current.mounted).toBe(true); // one tick early — still there

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.mounted).toBe(false);
  });

  test('re-showing mid-exit cancels the unmount', () => {
    // The visitor reopens something while it is fading out. If the pending
    // timer still fired, the element would vanish after it had come back.
    const { result, rerender } = renderHook(({ s }) => useMountTransition(s, DURATION), {
      initialProps: { s: true },
    });
    flushFrames();

    act(() => {
      rerender({ s: false });
    });
    act(() => {
      jest.advanceTimersByTime(DURATION / 2);
    });

    act(() => {
      rerender({ s: true });
    });
    flushFrames();
    act(() => {
      jest.advanceTimersByTime(DURATION * 2);
    });

    expect(result.current.mounted).toBe(true);
    expect(result.current.visible).toBe(true);
  });

  test('unmounting the host does not leave the timer to fire', () => {
    const { rerender, unmount } = renderHook(({ s }) => useMountTransition(s, DURATION), {
      initialProps: { s: true },
    });
    flushFrames();
    act(() => {
      rerender({ s: false });
    });

    unmount();
    // A setState after unmount is the classic leak this cleanup prevents.
    expect(() => jest.advanceTimersByTime(DURATION * 2)).not.toThrow();
  });
});
