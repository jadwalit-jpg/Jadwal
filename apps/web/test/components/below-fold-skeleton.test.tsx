/**
 * A skeleton whose SHAPE disagrees with the real content is not a cosmetic
 * problem — it is a layout-shift bomb, and it fails silently because both
 * states render fine on their own.
 *
 * This is the bug these tests exist for: Featured was changed from a 3-column
 * grid to a horizontal scroll row, and its skeleton was left as a grid. On
 * mobile the grid stacks 6 cards (~2,280px) where the real row is ~380px, so
 * the moment the lazy chunk mounted the page collapsed ~1,900px. Lighthouse
 * measured CLS 0.488 — effectively the site's entire CLS budget — and pinned
 * `section#featured > div.max-w-7xl > div.relative`.
 *
 * Nothing in the type system or the linter can catch a skeleton drifting from
 * the component it mirrors, so it is asserted here.
 */
import { render } from '@testing-library/react';
import {
  BelowFoldSkeleton,
  CardRowSkeleton,
  CardGridSkeleton,
} from '@/app/_home-islands/below-fold-skeleton';

/** The wrapper classes the LIVE Featured row uses in home-below-fold.tsx. */
const LIVE_ROW_CARD_CLASSES = 'shrink-0 w-[78vw] max-w-[300px] sm:w-[300px] md:w-[320px] sm:max-w-none';

/**
 * Tailwind's arbitrary-value classes (`h-[260px]`, `lg:grid-cols-3`) contain
 * characters jsdom's CSS selector parser rejects, so match on className strings
 * rather than querySelector.
 */
function classNames(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('*')).map((el) => (el as HTMLElement).className || '');
}
function countWithClass(root: HTMLElement, cls: string): number {
  return classNames(root).filter((c) => c.split(/\s+/).includes(cls)).length;
}

describe('CardRowSkeleton mirrors the live Featured row', () => {
  test('scrolls horizontally instead of stacking', () => {
    const { container } = render(<CardRowSkeleton />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain('overflow-x-auto');
    // The grid classes are what caused the shift — they must NOT be here.
    expect(row.className).not.toContain('grid-cols-1');
    expect(row.className).not.toContain('sm:grid-cols-2');
  });

  test('each card uses the EXACT wrapper classes of the live row', () => {
    // Byte-identical, because any divergence reintroduces a height delta.
    const { container } = render(<CardRowSkeleton />);
    const cards = container.querySelectorAll('.shrink-0');
    expect(cards.length).toBeGreaterThan(0);
    for (const c of Array.from(cards)) {
      expect(c.className).toBe(LIVE_ROW_CARD_CLASSES);
    }
  });

  test('renders a fixed number of cards so the reserved height is deterministic', () => {
    const { container } = render(<CardRowSkeleton />);
    expect(container.querySelectorAll('.shrink-0')).toHaveLength(6);
  });
});

describe('CardGridSkeleton still mirrors Near You', () => {
  test('Near You is a real grid, so its skeleton must stay a grid', () => {
    const { container } = render(<CardGridSkeleton />);
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.className).toContain('grid-cols-1');
    expect(grid.className).toContain('sm:grid-cols-2');
    expect(grid.className).toContain('lg:grid-cols-3');
  });
});

describe('BelowFoldSkeleton uses the right shape per section', () => {
  test('exactly one horizontally-scrolling activity-card row (Featured)', () => {
    // Trending has its own bespoke row skeleton with a different card shape, so
    // the ActivityCard-based scroll row should appear once: Featured.
    const { container } = render(<BelowFoldSkeleton />);
    const exact = classNames(container as unknown as HTMLElement)
      .filter((c) => c === LIVE_ROW_CARD_CLASSES);
    expect(exact).toHaveLength(6); // one row of 6 cards
  });

  test('exactly one 3-col card grid remains (Near You)', () => {
    const { container } = render(<BelowFoldSkeleton />);
    expect(countWithClass(container as unknown as HTMLElement, 'lg:grid-cols-3')).toBe(1);
  });

  test('the static Why/CTA blocks still reserve their height', () => {
    // These have no queries; their only job is stopping the footer from jumping.
    const { container } = render(<BelowFoldSkeleton />);
    const root = container as unknown as HTMLElement;
    expect(countWithClass(root, 'h-[260px]')).toBe(1);
    expect(countWithClass(root, 'h-[300px]')).toBe(1);
  });
});
