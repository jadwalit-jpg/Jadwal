import { render, screen, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/context/auth-context';
import api from '@/lib/api';
import { __mock as navMock } from 'next/navigation';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

function Consumer() {
  const { user, loading, login, logout } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="user">{user ? user.email : 'anon'}</div>
      <div data-testid="role">{user?.role ?? ''}</div>
      <button onClick={() => login('naji@jadwal.app', 'S3cret!')} data-testid="login">login</button>
      <button onClick={() => logout()} data-testid="logout">logout</button>
    </div>
  );
}

beforeEach(() => {
  navMock.pathname = '/';
  navMock.replace.mockReset();
  mockedApi.get.mockReset();
  mockedApi.post.mockReset();
});

describe('useAuth', () => {
  it('throws a clear error when used outside an AuthProvider', () => {
    // The error surfaces as a React render error — swallow console noise to
    // keep the test output readable, then assert via .toThrow.
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    function Bare() { useAuth(); return null; }
    expect(() => render(<Bare />)).toThrow(/useAuth must be used within an AuthProvider/);
    errSpy.mockRestore();
  });

  it('calls /auth/me on mount and stores the returned user', async () => {
    mockedApi.get.mockResolvedValueOnce({
      status: 200,
      data: { id: 'u1', email: 'naji@jadwal.app', fullName: 'Naji', role: 'CUSTOMER' },
    });

    render(wrap(<Consumer />));

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('naji@jadwal.app'));
    expect(screen.getByTestId('role')).toHaveTextContent('CUSTOMER');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(mockedApi.get).toHaveBeenCalledWith('/auth/me', expect.any(Object));
  });

  it('skips /auth/me on login-type paths and renders anon immediately', async () => {
    navMock.pathname = '/admin/login';

    render(wrap(<Consumer />));

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('user')).toHaveTextContent('anon');
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('falls back to anon when /auth/me returns 401', async () => {
    mockedApi.get.mockResolvedValueOnce({ status: 401, data: null });

    render(wrap(<Consumer />));

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('user')).toHaveTextContent('anon');
  });

  it('falls back to anon when /auth/me throws (network down)', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('Network Error'));

    render(wrap(<Consumer />));

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('user')).toHaveTextContent('anon');
  });

  it('login() POSTs credentials and stores the user returned', async () => {
    mockedApi.get.mockResolvedValueOnce({ status: 401, data: null });
    mockedApi.post.mockResolvedValueOnce({
      data: { id: 'u2', email: 'naji@jadwal.app', fullName: 'N', role: 'CUSTOMER' },
    });

    render(wrap(<Consumer />));
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    await act(async () => {
      screen.getByTestId('login').click();
    });

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('naji@jadwal.app'));
    expect(mockedApi.post).toHaveBeenCalledWith('/auth/login', {
      email: 'naji@jadwal.app',
      password: 'S3cret!',
    });
  });

  it('logout() clears user and redirects admins to /admin/login', async () => {
    mockedApi.get.mockResolvedValueOnce({
      status: 200,
      data: { id: 'a1', email: 'admin@jadwal.com', fullName: 'A', role: 'ADMIN' },
    });
    mockedApi.post.mockResolvedValueOnce({ data: { ok: true } });

    render(wrap(<Consumer />));
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('ADMIN'));

    await act(async () => {
      screen.getByTestId('logout').click();
    });

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('anon'));
    expect(navMock.replace).toHaveBeenCalledWith('/admin/login');
  });

  it('logout() redirects vendors to /login and customers to /', async () => {
    mockedApi.get.mockResolvedValueOnce({
      status: 200,
      data: { id: 'v1', email: 'vendor@jadwal.com', fullName: 'V', role: 'VENDOR' },
    });
    mockedApi.post.mockResolvedValueOnce({ data: { ok: true } });

    render(wrap(<Consumer />));
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('VENDOR'));

    await act(async () => {
      screen.getByTestId('logout').click();
    });

    await waitFor(() => expect(navMock.replace).toHaveBeenCalledWith('/login'));
  });

  it('still clears local state if the logout API call fails', async () => {
    mockedApi.get.mockResolvedValueOnce({
      status: 200,
      data: { id: 'u3', email: 'c@jadwal.com', fullName: 'C', role: 'CUSTOMER' },
    });
    mockedApi.post.mockRejectedValueOnce(new Error('Network Error'));

    render(wrap(<Consumer />));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('c@jadwal.com'));

    await act(async () => {
      screen.getByTestId('logout').click();
    });

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('anon'));
    expect(navMock.replace).toHaveBeenCalledWith('/');
  });

  it('responds to the global auth:session-expired event by clearing the user', async () => {
    mockedApi.get.mockResolvedValueOnce({
      status: 200,
      data: { id: 'u4', email: 'x@jadwal.com', fullName: 'X', role: 'CUSTOMER' },
    });

    render(wrap(<Consumer />));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('x@jadwal.com'));

    await act(async () => {
      window.dispatchEvent(new Event('auth:session-expired'));
    });

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('anon'));
  });
});
