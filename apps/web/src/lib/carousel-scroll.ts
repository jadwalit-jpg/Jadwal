/**
 * Horizontal carousel arrow maths, kept out of the component so it can be
 * tested without a DOM.
 *
 * THE RTL TRAP. In a right-to-left container, spec-compliant browsers report
 * `scrollLeft` as 0 at the START (content's right edge) and count DOWN to
 * `-(scrollWidth - clientWidth)` at the end. So a positive `scrollBy({ left })`
 * — which advances in LTR — moves the wrong way in RTL, and from the initial
 * position 0 it is immediately clamped back to 0: the arrow appears completely
 * dead. That was the bug, and it made both arrows unresponsive in Arabic until
 * the user toggled the language.
 *
 * The direction is read from the ELEMENT's computed style at click time rather
 * than from the i18n language state, because only the element knows what the
 * browser is actually doing; an i18n value can lag a hydration or a language
 * switch and then the maths silently disagrees with the DOM.
 */

export type ScrollDirection = 'prev' | 'next';

export interface CarouselMetrics {
  /** Visible width of the scroller. */
  clientWidth: number;
  /** Total scrollable content width. */
  scrollWidth: number;
  /** Raw scrollLeft — NEGATIVE in RTL on spec-compliant browsers. */
  scrollLeft: number;
  /** True when the scroller's computed direction is rtl. */
  rtl: boolean;
}

/** How close to an edge still counts as "at the edge", in px. */
const EDGE_TOLERANCE = 4;

/**
 * The `left` delta to hand to `Element.scrollBy` for one arrow press.
 *
 * Wraps around: pressing next on the last card returns to the first, and prev
 * on the first jumps to the last. The wrap uses a full `scrollWidth` shift,
 * which the browser clamps to the far end.
 */
export function computeScrollDelta(
  direction: ScrollDirection,
  { clientWidth, scrollWidth, scrollLeft, rtl }: CarouselMetrics,
): number {
  // +1 advances left-to-right, -1 advances right-to-left.
  const sign = rtl ? -1 : 1;

  // Distance travelled from the start, as a positive number in BOTH directions
  // (RTL scrollLeft is negative, so take the magnitude).
  const travelled = Math.abs(scrollLeft);
  const maxScroll = Math.max(0, scrollWidth - clientWidth);

  const atEnd = travelled >= maxScroll - EDGE_TOLERANCE;
  const atStart = travelled <= EDGE_TOLERANCE;

  // Nothing to scroll — one screen holds everything.
  if (maxScroll === 0) return 0;

  if (direction === 'next' && atEnd) return -sign * scrollWidth; // wrap to first
  if (direction === 'prev' && atStart) return sign * scrollWidth; // wrap to last

  // ~one card plus its gap.
  const amount = Math.round(clientWidth * 0.85);
  return direction === 'next' ? sign * amount : -sign * amount;
}

/** Read the live metrics off a scroller, including its REAL text direction. */
export function readCarouselMetrics(el: HTMLElement): CarouselMetrics {
  return {
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
    scrollLeft: el.scrollLeft,
    rtl:
      typeof window !== 'undefined' &&
      window.getComputedStyle(el).direction === 'rtl',
  };
}
