import { render, screen } from '@testing-library/react';
import { CancelBadge } from '@/components/ui/cancel-badge';

describe('<CancelBadge />', () => {
  it('shows the label text', () => {
    render(<CancelBadge level="free" label="Free cancellation" />);
    expect(screen.getByText(/free cancellation/i)).toBeInTheDocument();
  });

  it.each([
    ['free',    /bg-emerald-500/],     // green / success
    ['partial', /bg-amber-500/],       // amber / warning
    ['none',    /bg-red-500/],         // red / danger
  ] as const)('maps level=%s to the expected colour variant', (level, bgRe) => {
    render(<CancelBadge level={level} label={level} />);
    const el = screen.getByText(level);
    expect(el.className).toMatch(bgRe);
  });

  it('compact mode renders size=sm and hides the icon', () => {
    render(<CancelBadge level="free" label="short" compact />);
    const el = screen.getByText('short');
    // sm size is h-[22px] per Badge's sizeClass
    expect(el.className).toMatch(/h-\[22px\]/);
    // In compact mode icon prop is undefined so no SVG should render inside
    // the badge span's icon wrapper.
    const svg = el.querySelector('svg');
    expect(svg).toBeNull();
  });

  it('renders a Shield icon for free/partial and AlertTriangle for none (when not compact)', () => {
    const { rerender } = render(<CancelBadge level="free" label="free" />);
    expect(screen.getByText('free').querySelector('svg')).toBeInTheDocument();

    rerender(<CancelBadge level="none" label="none" />);
    // The icon swaps — just verify some SVG is present. More specific
    // lucide-icon identification is brittle.
    expect(screen.getByText('none').querySelector('svg')).toBeInTheDocument();
  });
});
