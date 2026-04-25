/**
 * Smoke-level coverage for the small presentational primitives that would be
 * expensive to test in isolation and cheap to lump together: Skeleton,
 * RouteSpinner, PatternDivider. Each one's job is "don't crash + expose the
 * right ARIA shape if interactive."
 */
import { render, screen } from '@testing-library/react';
import { Skeleton } from '@/components/ui/skeleton';
import { RouteSpinner } from '@/components/ui/route-spinner';
import { PatternDivider } from '@/components/ui/pattern-divider';

describe('<Skeleton />', () => {
  it('renders a div with the jadwal-skeleton class', () => {
    const { container } = render(<Skeleton className="h-4" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toMatch(/jadwal-skeleton/);
    expect(el.className).toMatch(/\bh-4\b/);
  });
});

describe('<RouteSpinner />', () => {
  it('declares role=status + aria-busy for screen readers', () => {
    render(<RouteSpinner />);
    const el = screen.getByRole('status');
    expect(el).toHaveAttribute('aria-busy', 'true');
    expect(el).toHaveAttribute('aria-live', 'polite');
  });

  it('renders the default visually-hidden label', () => {
    render(<RouteSpinner />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders a custom label when provided', () => {
    render(<RouteSpinner label="Fetching vendor dashboard" />);
    expect(screen.getByText(/fetching vendor dashboard/i)).toBeInTheDocument();
  });
});

describe('<PatternDivider />', () => {
  it('renders a decorative SVG marked aria-hidden (no screen-reader noise)', () => {
    const { container } = render(<PatternDivider />);
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root.querySelector('svg')).toBeInTheDocument();
  });
});
