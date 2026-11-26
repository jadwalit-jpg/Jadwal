/**
 * The review-ask pop-up: where it may appear, and that Submit / Later /
 * "Don't ask again" call the right endpoints.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let pathname = '/';
let user: { id: string; role: string } | null = { id: 'u1', role: 'CUSTOMER' };
const api = { get: jest.fn(), post: jest.fn() };
const toast = jest.fn();

jest.mock('next/navigation', () => ({ usePathname: () => pathname }));
jest.mock('@/context/auth-context', () => ({ useAuth: () => ({ user, loading: false }) }));
jest.mock('@/lib/api', () => ({ __esModule: true, default: api }));
jest.mock('@/lib/api-error', () => ({ getApiError: (_e: unknown, fallback: string) => fallback }));
jest.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
jest.mock('@/lib/localize', () => ({ localized: (obj: Record<string, string>, field: string) => obj[`${field}En`] }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string } & Record<string, unknown>) => {
      const base = opts?.defaultValue ?? key;
      return opts ? base.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(opts[k] ?? '')) : base;
    },
  }),
}));

import { ReviewPrompt, reviewPromptAllowedOn } from '../../src/components/review-prompt';

const prompt = {
  bookingId: 'b-1', bookingRef: 'JDWL-E2ERVWA', endDate: '2026-11-20T18:00:00.000Z',
  activity: { id: 'a-1', titleEn: 'Desert Camp', titleAr: 'مخيم', slug: 'desert-camp', coverImage: '/cover.jpg' },
};

function renderPrompt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ReviewPrompt delayMs={0} /></QueryClientProvider>);
}

describe('reviewPromptAllowedOn', () => {
  it('never on booking, payment, auth, review, admin or vendor pages (EN and AR paths)', () => {
    for (const p of ['/activity/x/book', '/ar/activity/x/book', '/bookings', '/bookings/abc', '/payment/callback', '/login', '/register', '/review/JDWL-1', '/ar/review/JDWL-1', '/admin/bookings', '/vendor/s/dashboard', '/checkout']) {
      expect(reviewPromptAllowedOn(p)).toBe(false);
    }
    for (const p of ['/', '/ar', '/explore', '/ar/explore', '/activity/x', '/profile', '/offers']) {
      expect(reviewPromptAllowedOn(p)).toBe(true);
    }
    expect(reviewPromptAllowedOn(null)).toBe(false);
  });
});

describe('ReviewPrompt', () => {
  beforeEach(() => {
    pathname = '/';
    user = { id: 'u1', role: 'CUSTOMER' };
    api.get.mockReset(); api.post.mockReset(); toast.mockReset();
    api.get.mockResolvedValue({ data: { prompt } });
    api.post.mockResolvedValue({ data: {} });
  });
  async function open() {
    renderPrompt();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/customer/review-prompts/next'));
    return await screen.findByTestId('review-prompt');
  }

  it('shows the activity and five stars after a short delay, and submits the rating', async () => {
    const dialog = await open();
    expect(dialog).toHaveTextContent('How was Desert Camp?');
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    const submit = screen.getByTestId('review-prompt-submit');
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByTestId('review-prompt-star-4'));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/customer/reviews', { activityId: 'a-1', rating: 4 }));
    await waitFor(() => expect(screen.queryByTestId('review-prompt')).toBeNull());
    expect(toast).toHaveBeenCalledWith('Review submitted!');
  });

  it('Later and Don\'t ask again call dismiss with the right mode and close the dialog', async () => {
    await open();
    fireEvent.click(screen.getByTestId('review-prompt-later'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/customer/review-prompts/b-1/dismiss', { mode: 'later' }));
    await waitFor(() => expect(screen.queryByTestId('review-prompt')).toBeNull());

    // Re-open with a new query client for "never".
    api.post.mockClear();
    await open();
    fireEvent.click(screen.getByTestId('review-prompt-never'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/customer/review-prompts/b-1/dismiss', { mode: 'never' }));
  });

  it('does not fetch or render on an excluded page, for a signed-out visitor, or for a vendor', async () => {
    pathname = '/bookings/abc';
    renderPrompt();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.queryByTestId('review-prompt')).toBeNull();

    pathname = '/';
    user = null;
    renderPrompt();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(api.get).not.toHaveBeenCalled();

    user = { id: 'v1', role: 'VENDOR' };
    renderPrompt();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(api.get).not.toHaveBeenCalled();
  });

  it('renders nothing when the API has no ask', async () => {
    api.get.mockResolvedValue({ data: { prompt: null } });
    renderPrompt();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByTestId('review-prompt')).toBeNull();
  });
});
