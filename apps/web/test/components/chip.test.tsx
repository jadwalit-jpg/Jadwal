import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chip } from '@/components/ui/chip';

describe('<Chip />', () => {
  it('renders as a button (not a toggle div — keyboard + a11y)', () => {
    render(<Chip>All</Chip>);
    expect(screen.getByRole('button', { name: /all/i })).toBeInTheDocument();
  });

  it('defaults to type=button to avoid accidental form submits', () => {
    render(<Chip>label</Chip>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('reflects active state via aria-pressed for screen readers', () => {
    const { rerender } = render(<Chip active>Filter</Chip>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
    rerender(<Chip active={false}>Filter</Chip>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('fires onClick when pressed', async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();
    render(<Chip onClick={onClick}>Pick</Chip>);
    await user.click(screen.getByRole('button', { name: /pick/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders an optional icon before the label', () => {
    render(<Chip icon={<span data-testid="icon">i</span>}>Food</Chip>);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByText(/food/i)).toBeInTheDocument();
  });

  it('honors disabled (no click event)', async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();
    render(<Chip disabled onClick={onClick}>Off</Chip>);
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('supports sm and md size classes', () => {
    const { rerender } = render(<Chip size="sm">s</Chip>);
    expect(screen.getByRole('button').className).toMatch(/h-\[26px\]/);
    rerender(<Chip size="md">m</Chip>);
    expect(screen.getByRole('button').className).toMatch(/h-\[32px\]/);
  });
});
