/**
 * The reported bug: on the Arabic home page, the Trending / Featured arrows did
 * nothing. Pressing them in English first, then switching back to Arabic, made
 * them start working.
 *
 * Cause: every branch of the old maths assumed left-to-right. In RTL,
 * spec-compliant browsers report scrollLeft as 0 at the START and count DOWN to
 * -(scrollWidth - clientWidth). The old code sent a POSITIVE scrollBy for
 * "next", which from the initial position 0 is out of range and gets clamped
 * straight back to 0 — no movement, arrow looks broken.
 *
 * The first test below is that exact scenario and fails against the old code.
 */
import { computeScrollDelta } from '@/lib/carousel-scroll';

const WIDE = { clientWidth: 1000, scrollWidth: 3000 }; // maxScroll = 2000

describe('computeScrollDelta — the reported Arabic bug', () => {
  test('RTL, at the start, "next" scrolls FORWARD (negative) instead of nothing', () => {
    const delta = computeScrollDelta('next', { ...WIDE, scrollLeft: 0, rtl: true });
    // Must be negative: RTL advances by decreasing scrollLeft.
    expect(delta).toBeLessThan(0);
    // And must actually move roughly one card, not a no-op.
    expect(Math.abs(delta)).toBe(850);
  });

  test('LTR, at the start, "next" still scrolls forward (positive) — no regression', () => {
    const delta = computeScrollDelta('next', { ...WIDE, scrollLeft: 0, rtl: false });
    expect(delta).toBe(850);
  });
});

describe('computeScrollDelta — mid-carousel', () => {
  test.each([
    ['LTR next', 'next' as const, false, 500, 850],
    ['LTR prev', 'prev' as const, false, 500, -850],
    // RTL scrollLeft is negative; signs mirror LTR exactly.
    ['RTL next', 'next' as const, true, -500, -850],
    ['RTL prev', 'prev' as const, true, -500, 850],
  ])('%s moves one card in the reading direction', (_l, dir, rtl, scrollLeft, expected) => {
    expect(computeScrollDelta(dir, { ...WIDE, scrollLeft, rtl })).toBe(expected);
  });
});

describe('computeScrollDelta — wrap-around at the edges', () => {
  test('LTR: "next" on the last card wraps back to the first', () => {
    const d = computeScrollDelta('next', { ...WIDE, scrollLeft: 2000, rtl: false });
    expect(d).toBe(-3000); // full-width negative shift, browser clamps at 0
  });

  test('LTR: "prev" on the first card wraps to the last', () => {
    expect(computeScrollDelta('prev', { ...WIDE, scrollLeft: 0, rtl: false })).toBe(3000);
  });

  test('RTL: "next" on the last card wraps back to the first', () => {
    // At the RTL end scrollLeft is -2000; wrapping to the start means going UP to 0.
    const d = computeScrollDelta('next', { ...WIDE, scrollLeft: -2000, rtl: true });
    expect(d).toBe(3000);
  });

  test('RTL: "prev" on the first card wraps to the last', () => {
    expect(computeScrollDelta('prev', { ...WIDE, scrollLeft: 0, rtl: true })).toBe(-3000);
  });

  test.each([
    ['LTR', false, 1997],
    ['RTL', true, -1997],
  ])('%s: within the 4px edge tolerance still counts as the end', (_l, rtl, scrollLeft) => {
    const d = computeScrollDelta('next', { ...WIDE, scrollLeft, rtl });
    // Wrapped (full-width shift), not a one-card nudge.
    expect(Math.abs(d)).toBe(3000);
  });
});

describe('computeScrollDelta — nothing to scroll', () => {
  test.each([
    ['LTR', false],
    ['RTL', true],
  ])('%s: content fits on screen, so both arrows are a no-op', (_l, rtl) => {
    const fits = { clientWidth: 1000, scrollWidth: 1000, scrollLeft: 0, rtl };
    expect(computeScrollDelta('next', fits)).toBe(0);
    expect(computeScrollDelta('prev', fits)).toBe(0);
  });
});

describe('computeScrollDelta — LTR and RTL are exact mirrors', () => {
  // Guards against a future one-sided fix: whatever LTR does, RTL must do with
  // the opposite sign at the mirrored scroll position.
  test.each([0, 500, 1200, 2000])('mirrored at offset %d', (offset) => {
    for (const dir of ['next', 'prev'] as const) {
      const ltr = computeScrollDelta(dir, { ...WIDE, scrollLeft: offset, rtl: false });
      const rtl = computeScrollDelta(dir, { ...WIDE, scrollLeft: -offset, rtl: true });
      expect(rtl).toBe(-ltr);
    }
  });
});
