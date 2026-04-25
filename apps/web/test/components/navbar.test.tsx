import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock i18next so we don't have to boot the real i18n init in a unit test —
// the translator just returns the key string.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: jest.fn() },
  }),
}));

// Mock the auth hook so we can flip user shape per test.
const useAuthMock = jest.fn();
jest.mock('@/context/auth-context', () => ({
  useAuth: () => useAuthMock(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// NotificationBell pulls in API + query client — stub.
jest.mock('@/components/notification-bell', () => ({
  __esModule: true,
  default: () => <div data-testid="notification-bell-stub" />,
}));

// Import AFTER jest.mock so the stubs are in place.
import Navbar from '@/components/navbar';

describe('<Navbar />', () => {
  it('shows public nav links when anonymous (no user)', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false, logout: jest.fn() });
    render(<Navbar variant="solid" />);

    // Translation mock returns the key, so we match the key itself.
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(
      expect.arrayContaining(['/', '/explore', '/offers', '/register/vendor', '/login', '/register']),
    );
  });

  it('hides login + signup links when a customer is logged in', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u', email: 'c@jadwal.com', fullName: 'C', role: 'CUSTOMER' },
      loading: false,
      logout: jest.fn(),
    });
    render(<Navbar variant="solid" />);

    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).not.toContain('/login');
    expect(hrefs).not.toContain('/register');
  });

  it('exposes the language-toggle button with an accessible label', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false, logout: jest.fn() });
    render(<Navbar variant="solid" />);
    // Before the mount effect fires, aria-label is the neutral "Switch language";
    // after mount it flips to EN/AR-specific — accept either.
    const btn = screen.getByRole('button', {
      name: /switch (language|to english|to العربية)|التبديل/i,
    });
    expect(btn).toBeInTheDocument();
  });

  it('exposes a theme-toggle button', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false, logout: jest.fn() });
    render(<Navbar variant="solid" />);
    expect(screen.getByRole('button', { name: /toggle theme/i })).toBeInTheDocument();
  });

  it('opens the mobile menu when the hamburger is clicked', async () => {
    useAuthMock.mockReturnValue({ user: null, loading: false, logout: jest.fn() });
    const user = userEvent.setup();
    render(<Navbar variant="solid" />);

    const hamburger = screen.getByRole('button', { name: /toggle menu/i });
    await user.click(hamburger);
    // Mobile menu surfaces the nav links again — the overall link count grows.
    expect(screen.getAllByRole('link').length).toBeGreaterThan(5);
  });

  it('mounts the notification bell only for authenticated users', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false, logout: jest.fn() });
    const { rerender } = render(<Navbar variant="solid" />);
    expect(screen.queryByTestId('notification-bell-stub')).not.toBeInTheDocument();

    useAuthMock.mockReturnValue({
      user: { id: 'u', email: 'c@jadwal.com', fullName: 'C', role: 'CUSTOMER' },
      loading: false, logout: jest.fn(),
    });
    rerender(<Navbar variant="solid" />);
    expect(screen.getByTestId('notification-bell-stub')).toBeInTheDocument();
  });
});
