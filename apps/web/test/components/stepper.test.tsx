import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Stepper } from '@/components/ui/stepper';

describe('<Stepper />', () => {
  it('renders two buttons (decrease / increase) and the current value', () => {
    render(<Stepper value={3} />);
    expect(screen.getByRole('button', { name: /decrease/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /increase/i })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('wraps in role=group with the provided aria label (a11y required)', () => {
    render(<Stepper value={1} ariaLabel="Guests" />);
    expect(screen.getByRole('group', { name: /guests/i })).toBeInTheDocument();
  });

  it('announces changes to screen readers via aria-live=polite', () => {
    render(<Stepper value={5} />);
    const live = screen.getByText('5');
    expect(live).toHaveAttribute('aria-live', 'polite');
  });

  it('calls onChange(value+1) when increase is clicked', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Stepper value={2} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /increase/i }));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('calls onChange(value-1) when decrease is clicked', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Stepper value={5} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /decrease/i }));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('disables decrease at min boundary', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Stepper value={0} min={0} onChange={onChange} />);
    const dec = screen.getByRole('button', { name: /decrease/i });
    expect(dec).toBeDisabled();
    await user.click(dec);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables increase at max boundary', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Stepper value={20} max={20} onChange={onChange} />);
    const inc = screen.getByRole('button', { name: /increase/i });
    expect(inc).toBeDisabled();
    await user.click(inc);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables BOTH buttons when `disabled` prop is set', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Stepper value={5} disabled onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /increase/i }));
    await user.click(screen.getByRole('button', { name: /decrease/i }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
