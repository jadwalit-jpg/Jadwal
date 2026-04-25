import { render, screen, waitFor } from '@testing-library/react';
import { __mock as navMock } from 'next/navigation';

const useAuthMock = jest.fn();
jest.mock('@/context/auth-context', () => ({
  useAuth: () => useAuthMock(),
}));

import { RoleGuard } from '@/components/role-guard';

beforeEach(() => {
  navMock.pathname = '/';
  navMock.replace.mockReset();
});

describe('<RoleGuard />', () => {
  it('shows a spinner while auth is loading', () => {
    useAuthMock.mockReturnValue({ user: null, loading: true });
    render(
      <RoleGuard allowedRoles={['ADMIN']}>
        <div data-testid="child">secret</div>
      </RoleGuard>,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  it('renders children when the user has an allowed role', () => {
    useAuthMock.mockReturnValue({
      user: { role: 'ADMIN' }, loading: false,
    });
    render(
      <RoleGuard allowedRoles={['ADMIN']}>
        <div data-testid="child">secret</div>
      </RoleGuard>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders null and does NOT render children when role is wrong', async () => {
    useAuthMock.mockReturnValue({
      user: { role: 'CUSTOMER' }, loading: false,
    });
    render(
      <RoleGuard allowedRoles={['ADMIN']}>
        <div data-testid="child">secret</div>
      </RoleGuard>,
    );
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  describe('redirects unauthenticated users by path prefix', () => {
    it('/admin/* → /admin/login', async () => {
      navMock.pathname = '/admin/dashboard';
      useAuthMock.mockReturnValue({ user: null, loading: false });
      render(<RoleGuard allowedRoles={['ADMIN']}><div /></RoleGuard>);
      await waitFor(() => expect(navMock.replace).toHaveBeenCalledWith('/admin/login'));
    });

    it('/vendor/* → /register/vendor', async () => {
      navMock.pathname = '/vendor/abc/dashboard';
      useAuthMock.mockReturnValue({ user: null, loading: false });
      render(<RoleGuard allowedRoles={['VENDOR']}><div /></RoleGuard>);
      await waitFor(() => expect(navMock.replace).toHaveBeenCalledWith('/register/vendor'));
    });

    it('other pages → /', async () => {
      navMock.pathname = '/my-bookings';
      useAuthMock.mockReturnValue({ user: null, loading: false });
      render(<RoleGuard allowedRoles={['CUSTOMER']}><div /></RoleGuard>);
      await waitFor(() => expect(navMock.replace).toHaveBeenCalledWith('/'));
    });
  });

  describe('redirects wrong-role users to their home dashboard', () => {
    it('ADMIN → /admin/dashboard', async () => {
      useAuthMock.mockReturnValue({
        user: { role: 'ADMIN' }, loading: false,
      });
      render(<RoleGuard allowedRoles={['CUSTOMER']}><div /></RoleGuard>);
      await waitFor(() => expect(navMock.replace).toHaveBeenCalledWith('/admin/dashboard'));
    });

    it('VENDOR → /vendor/<slug>/dashboard', async () => {
      useAuthMock.mockReturnValue({
        user: { role: 'VENDOR', vendor: { slug: 'my-biz' } }, loading: false,
      });
      render(<RoleGuard allowedRoles={['ADMIN']}><div /></RoleGuard>);
      await waitFor(() => expect(navMock.replace).toHaveBeenCalledWith('/vendor/my-biz/dashboard'));
    });

    it('VENDOR with no vendor.slug → /vendor/portal/dashboard (safe fallback)', async () => {
      useAuthMock.mockReturnValue({
        user: { role: 'VENDOR' }, loading: false,
      });
      render(<RoleGuard allowedRoles={['ADMIN']}><div /></RoleGuard>);
      await waitFor(() => expect(navMock.replace).toHaveBeenCalledWith('/vendor/portal/dashboard'));
    });

    it('CUSTOMER (or anything else) → /', async () => {
      useAuthMock.mockReturnValue({
        user: { role: 'CUSTOMER' }, loading: false,
      });
      render(<RoleGuard allowedRoles={['ADMIN']}><div /></RoleGuard>);
      await waitFor(() => expect(navMock.replace).toHaveBeenCalledWith('/'));
    });
  });
});
