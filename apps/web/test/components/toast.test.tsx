import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToast } from '@/components/toast';

function Emitter({ msg, type }: { msg: string; type?: 'success' | 'error' }) {
  const { toast } = useToast();
  return (
    <button onClick={() => toast(msg, type)} data-testid="emit">emit</button>
  );
}

describe('<ToastProvider /> + useToast', () => {
  beforeAll(() => { jest.useFakeTimers(); });
  afterAll(() => { jest.useRealTimers(); });

  it('renders nothing until a toast is emitted', () => {
    render(
      <ToastProvider>
        <Emitter msg="x" />
      </ToastProvider>,
    );
    // No toast body visible yet
    expect(screen.queryByText('x')).not.toBeInTheDocument();
  });

  it('shows a success toast with the message when emitted', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(
      <ToastProvider>
        <Emitter msg="Saved" type="success" />
      </ToastProvider>,
    );
    await user.click(screen.getByTestId('emit'));
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('shows an error toast when type is "error"', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(
      <ToastProvider>
        <Emitter msg="Boom" type="error" />
      </ToastProvider>,
    );
    await user.click(screen.getByTestId('emit'));
    const el = screen.getByText('Boom');
    // Style fragment — red tint on error variants
    expect(el.closest('div')!.className).toMatch(/bg-red-500/);
  });

  it('auto-dismisses a toast after 4 seconds', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(
      <ToastProvider>
        <Emitter msg="Will fade" />
      </ToastProvider>,
    );
    await user.click(screen.getByTestId('emit'));
    expect(screen.getByText(/will fade/i)).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(4001);
    });

    expect(screen.queryByText(/will fade/i)).not.toBeInTheDocument();
  });

  it('stacks multiple toasts (does not clobber earlier ones)', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(
      <ToastProvider>
        <Emitter msg="First" />
        <Emitter msg="Second" />
      </ToastProvider>,
    );
    const buttons = screen.getAllByTestId('emit');
    await user.click(buttons[0]);
    await user.click(buttons[1]);
    expect(screen.getByText(/first/i)).toBeInTheDocument();
    expect(screen.getByText(/second/i)).toBeInTheDocument();
  });

  it('lets users dismiss a toast manually via the close button', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(
      <ToastProvider>
        <Emitter msg="Close me" />
      </ToastProvider>,
    );
    await user.click(screen.getByTestId('emit'));

    // Find the dismiss button inside the toast. It's the X icon sibling —
    // the only other button rendered is the emitter itself.
    const buttons = screen.getAllByRole('button');
    const closeBtn = buttons.find((b) => b.getAttribute('data-testid') !== 'emit')!;
    await user.click(closeBtn);

    expect(screen.queryByText(/close me/i)).not.toBeInTheDocument();
  });

  it('returns a no-op toast when useToast is called outside the provider (no crash)', () => {
    function BareEmitter() {
      const { toast } = useToast();
      // Should not throw — default context value is a no-op function
      return <button onClick={() => toast('x')}>emit</button>;
    }
    expect(() => render(<BareEmitter />)).not.toThrow();
  });
});
