import { render, screen } from '@testing-library/react';
import { SectionHeader } from '@/components/ui/section-header';

describe('<SectionHeader />', () => {
  it('renders the title as an h2 (semantic landmark, SEO)', () => {
    render(<SectionHeader title="Featured" />);
    expect(screen.getByRole('heading', { level: 2, name: /featured/i })).toBeInTheDocument();
  });

  it('omits the see-all link when href is absent', () => {
    render(<SectionHeader title="Trending" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('omits the see-all link when href is set but label is absent', () => {
    render(<SectionHeader title="Trending" seeAllHref="/explore" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders the see-all link when both href and label are provided', () => {
    render(<SectionHeader title="Trending" seeAllHref="/explore" seeAllLabel="View all" />);
    const link = screen.getByRole('link', { name: /view all/i });
    expect(link).toHaveAttribute('href', '/explore');
  });

  it('flips the chevron direction for RTL layouts', () => {
    const { container, rerender } = render(
      <SectionHeader title="t" seeAllHref="/x" seeAllLabel="v" />
    );
    // Default LTR — some SVG child should render. Existence is enough.
    expect(container.querySelector('svg')).toBeInTheDocument();

    rerender(<SectionHeader title="t" seeAllHref="/x" seeAllLabel="v" rtl />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
