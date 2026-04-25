import { render, screen } from '@testing-library/react';
import { Rating } from '@/components/ui/rating';

describe('<Rating />', () => {
  it('formats value to one decimal (4 → "4.0", 4.567 → "4.6")', () => {
    const { rerender } = render(<Rating value={4} />);
    expect(screen.getByText('4.0')).toBeInTheDocument();
    rerender(<Rating value={4.567} />);
    expect(screen.getByText('4.6')).toBeInTheDocument();
  });

  it('omits the count when not provided', () => {
    render(<Rating value={4.2} />);
    // No parenthesised count should appear
    expect(screen.queryByText(/^\(/)).not.toBeInTheDocument();
  });

  it('renders count in parentheses when provided', () => {
    render(<Rating value={4.2} count={1234} />);
    expect(screen.getByText('(1,234)')).toBeInTheDocument();
  });

  it('handles count=0 (edge case: no reviews yet but count explicitly passed)', () => {
    render(<Rating value={0} count={0} />);
    expect(screen.getByText('0.0')).toBeInTheDocument();
    expect(screen.getByText('(0)')).toBeInTheDocument();
  });

  it('supports size variants', () => {
    const { container, rerender } = render(<Rating value={3.5} size="xs" />);
    expect(container.querySelector('.text-\\[11px\\]')).toBeInTheDocument();
    rerender(<Rating value={3.5} size="lg" />);
    expect(container.querySelector('.text-\\[14px\\]')).toBeInTheDocument();
  });

  it('applies the dark colour scheme when `dark` is set', () => {
    const { container } = render(<Rating value={4} dark />);
    // Text flips to white; easiest to assert by class fragment
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toMatch(/text-white/);
  });
});
