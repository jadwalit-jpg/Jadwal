import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@/components/ui/button';

describe('<Button />', () => {
  it('renders its children and defaults to type=button (not submit — avoids accidental form submits)', () => {
    render(<Button>Click me</Button>);
    const btn = screen.getByRole('button', { name: /click me/i });
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('fires onClick when not disabled', async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await user.click(screen.getByRole('button', { name: /go/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick when disabled', async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();
    render(<Button disabled onClick={onClick}>Nope</Button>);
    await user.click(screen.getByRole('button', { name: /nope/i }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disables and shows spinner when loading, hiding the icon prop', () => {
    render(
      <Button loading icon={<span data-testid="lead-icon">i</span>}>
        Saving
      </Button>,
    );
    const btn = screen.getByRole('button', { name: /saving/i });
    expect(btn).toBeDisabled();
    // Icon prop is replaced by the spinner when loading
    expect(screen.queryByTestId('lead-icon')).not.toBeInTheDocument();
  });

  it('swallows clicks while loading', async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();
    render(<Button loading onClick={onClick}>Saving</Button>);
    await user.click(screen.getByRole('button', { name: /saving/i }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies `w-full` when the `full` prop is set', () => {
    render(<Button full>Wide</Button>);
    expect(screen.getByRole('button', { name: /wide/i }).className).toMatch(/\bw-full\b/);
  });

  it('supports a form submit type explicitly', () => {
    render(
      <form onSubmit={(e) => e.preventDefault()}>
        <Button type="submit">Submit</Button>
      </form>,
    );
    expect(screen.getByRole('button', { name: /submit/i })).toHaveAttribute('type', 'submit');
  });

  it('forwards refs so parent forms and a11y helpers can focus it', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Button ref={ref}>Focus me</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
