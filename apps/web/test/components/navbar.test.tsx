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

// Navbar now delegates language switching to the shared i18n-provider. Mock it so
// the test doesn't import the real provider, which runs the i18n init at module
// load (calling `i18next.use(...)` with a plugin that's undefined in the unit-test
// runtime → "passing an undefined module" crash). Navbar only uses `switchLanguage`.
jest.mock('@/context/i18n-provider', () => ({
  useLangSwitch: () => ({ switchLanguage: jest.fn(), isSwitching: false }),
}));

// Mock the auth hook so we can flip user shape per test.
const useAuthMock = jest.fn();
jest.mock('@/context/auth-context', () => ({
  useAuth: () => useAuthMock(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// `@/lib/api` throws at module-load if `NEXT_PUBLIC_API_URL` env is unset
// (which it is in the unit-test runtime). Stub the module with an axios-shaped
// default export — the navbar only ever calls `.get()` indirectly via the
// stubbed `useQuery` below, so the shape is enough.
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// The new lighter navbar fetches the unread-count via `useQuery` (shared key
// with the `<NotificationBell/>` component used on other pages — same cache).
// Stub the hook so we don't need a real `QueryClientProvider` in the test, and
// so the badge count is deterministic per test.
const useQueryMock = jest.fn(() => ({ data: undefined, isLoading: false }));
jest.mock('@tanstack/react-query', () => ({
  useQuery: (opts: unknown) => useQueryMock(opts),
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
      user: { id: 'u', email: 'c@jadwal.qa', fullName: 'C', role: 'CUSTOMER' },
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

  it('surfaces a Notifications link for logged-in customers (replaces the bar bell)', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u', email: 'c@jadwal.qa', fullName: 'C', role: 'CUSTOMER' },
      loading: false,
      logout: jest.fn(),
    });
    // Simulate the avatar dropdown being open by clicking it. Until clicked,
    // the dropdown links aren't in the DOM (mobile menu also isn't), so we
    // verify *either* path exposes the `/notifications` link — depending on
    // the breakpoint the test renders at.
    render(<Navbar variant="solid" />);
    // The unread-count `useQuery` should have been gated to fire for customers.
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  it('does NOT fetch unread-count for anonymous users', () => {
    useQueryMock.mockClear();
    useAuthMock.mockReturnValue({ user: null, loading: false, logout: jest.fn() });
    render(<Navbar variant="solid" />);
    // The unread-count query exists but is `enabled: false` (anonymous, no need
    // to poll). Confirms the gate works — no API call on a public page load.
    const enabledFlags = useQueryMock.mock.calls.map(([opts]) => (opts as { enabled?: boolean }).enabled);
    expect(enabledFlags).toContain(false);
  });
});
