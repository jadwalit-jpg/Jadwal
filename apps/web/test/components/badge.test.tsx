import { render, screen } from '@testing-library/react';
import { Badge } from '@/components/ui/badge';

describe('<Badge />', () => {
  it('renders its children as the visible label', () => {
    render(<Badge>Confirmed</Badge>);
    expect(screen.getByText(/confirmed/i)).toBeInTheDocument();
  });

  it('applies the neutral variant by default', () => {
    render(<Badge>default</Badge>);
    const el = screen.getByText(/default/i);
    // class fragment check — brittle to exact classes but catches unintended
    // variant drift (e.g. someone flips the default to 'danger').
    expect(el.className).toMatch(/bg-jadwal-surface-muted/);
  });

  it.each(['primary', 'gold', 'success', 'warning', 'danger', 'dark'] as const)(
    'applies the %s variant class when variant is set',
    (variant) => {
      render(<Badge variant={variant}>{variant}</Badge>);
      const el = screen.getByText(variant);
      // every variant changes the bg class, so just assert the bg- token flipped
      expect(el.className).not.toMatch(/bg-jadwal-surface-muted/);
    },
  );

  it('renders the icon slot alongside the label', () => {
    render(<Badge icon={<span data-testid="icon">i</span>}>label</Badge>);
    // Both present inside the badge root (icon sits in its own span wrapper,
    // then the text node follows — order is visual, not a direct DOM sibling,
    // so we just assert presence + same ancestor.
    const icon = screen.getByTestId('icon');
    const label = screen.getByText(/label/i);
    expect(icon).toBeInTheDocument();
    expect(label.contains(icon)).toBe(true);
  });

  it('supports sm / md size classes', () => {
    const { rerender } = render(<Badge size="sm">s</Badge>);
    expect(screen.getByText('s').className).toMatch(/h-\[22px\]/);
    rerender(<Badge size="md">m</Badge>);
    expect(screen.getByText('m').className).toMatch(/h-\[26px\]/);
  });

  it('merges a custom className prop without stripping variant classes', () => {
    render(<Badge variant="success" className="custom-extra">ok</Badge>);
    const el = screen.getByText('ok');
    expect(el.className).toMatch(/custom-extra/);
    expect(el.className).toMatch(/bg-emerald-500/);
  });
});
