/**
 * Admin → Featured order page.
 *
 * Rows render in the server's order with position numbers; Up / Down move a
 * row and enable "Save order"; Save sends the whole order once and shows the
 * toast; a hidden listing carries the badge and reason; the "Only the first
 * 20" line appears only past 20; Remove asks, unfeatures the listing and keeps
 * the unsaved moves; a 409 shows the server's message.
 *
 * Dragging is dnd-kit's behaviour (no jsdom pointer events); the pure helpers
 * it feeds are covered directly.
 */
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const toast = jest.fn();
jest.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
jest.mock('@/lib/api-error', () => ({
  getApiError: (e: unknown, fallback: string) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback,
}));
const api = { get: jest.fn(), put: jest.fn(), patch: jest.fn() };
jest.mock('@/lib/api', () => ({ __esModule: true, default: api }));
// The real layout needs auth + sidebar queries; the page is what is under test.
jest.mock('../../src/app/admin/_components/admin-layout', () => ({
  __esModule: true,
  default: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div><h1>{title}</h1>{children}</div>
  ),
}));

import AdminFeaturedOrderPage, {
  HOMEPAGE_FEATURED_LIMIT, SAVED_TOAST, moveItem, sameOrder, type FeaturedActivity,
} from '../../src/app/admin/activities/featured/page';

function activity(n: number, extra: Partial<FeaturedActivity> = {}): FeaturedActivity {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    titleEn: `Listing ${n}`, titleAr: `قائمة ${n}`, slug: `listing-${n}`,
    coverImage: n % 2 ? '/cover.webp' : null, status: 'ACTIVE', featuredOrder: n,
    vendor: { id: 'v1', businessNameEn: 'Desert Co', status: 'ACTIVE', deleted: false },
    city: { nameEn: 'Doha' }, country: { id: 'qa', nameEn: 'Qatar' },
    showsOnHomepage: true, hiddenReason: null,
    ...extra,
  };
}

function renderPage(list: FeaturedActivity[]) {
  api.get.mockResolvedValue({ data: { data: list, total: list.length, homepageLimit: 20 } });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AdminFeaturedOrderPage /></QueryClientProvider>);
}

/** English titles in on-screen order. */
const titlesOnScreen = () =>
  screen.getAllByRole('listitem').filter((li) => li.getAttribute('data-position')).map((li) => within(li).getAllByText(/^Listing \d+$/)[0].textContent);
const saveButton = () => screen.getByRole('button', { name: /save order/i });

beforeEach(() => {
  toast.mockClear(); api.get.mockReset(); api.put.mockReset(); api.patch.mockReset();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { (window.confirm as jest.Mock).mockRestore(); });

describe('helpers', () => {
  it('sameOrder compares ids in order', () => {
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameOrder(['a'], ['a', 'b'])).toBe(false);
  });
  it('moveItem moves within bounds and clamps at the ends', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 9)).toEqual(['a', 'b', 'c']);
  });
});

describe('Featured order page', () => {
  it('renders the rows in order with positions, both titles, vendor and city; Save is disabled', async () => {
    renderPage([activity(1), activity(2), activity(3)]);
    await screen.findByText('Listing 1');
    expect(titlesOnScreen()).toEqual(['Listing 1', 'Listing 2', 'Listing 3']);
    expect(screen.getByLabelText('Position 1')).toHaveTextContent('1');
    expect(screen.getByText('قائمة 1')).toBeInTheDocument();
    expect(screen.getAllByText(/Desert Co · Doha, Qatar/)).toHaveLength(3);
    expect(screen.getByTestId('featured-count')).toHaveTextContent('3 featured · the homepage shows the first 20');
    expect(saveButton()).toBeDisabled();
    expect(screen.queryByTestId('featured-limit-line')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/admin/activities/featured');
  });

  it('Down and Up move a row, enable Save, and Save sends the whole order once', async () => {
    renderPage([activity(1), activity(2), activity(3)]);
    await screen.findByText('Listing 1');
    expect(screen.getByRole('button', { name: 'Move "Listing 1" up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move "Listing 3" down' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Move "Listing 1" down' }));
    expect(titlesOnScreen()).toEqual(['Listing 2', 'Listing 1', 'Listing 3']);
    expect(saveButton()).toBeEnabled();
    expect(screen.getByTestId('unsaved-banner')).toHaveTextContent(/unsaved changes/i);

    fireEvent.click(screen.getByRole('button', { name: 'Move "Listing 3" up' }));
    expect(titlesOnScreen()).toEqual(['Listing 2', 'Listing 3', 'Listing 1']);

    // Moving back to the loaded order disables Save again (nothing to save).
    fireEvent.click(screen.getByRole('button', { name: 'Move "Listing 1" up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move "Listing 1" up' }));
    expect(titlesOnScreen()).toEqual(['Listing 1', 'Listing 2', 'Listing 3']);
    expect(saveButton()).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Move "Listing 1" down' }));
    api.put.mockResolvedValue({ data: { updated: 3 } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith('/admin/activities/featured/order', { ids: [activity(2).id, activity(1).id, activity(3).id] });
    await waitFor(() => expect(toast).toHaveBeenCalledWith(SAVED_TOAST));
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(screen.queryByTestId('unsaved-banner')).not.toBeInTheDocument();
  });

  it('a listing the homepage will not show carries the grey badge and the reason', async () => {
    renderPage([
      activity(1),
      activity(2, { status: 'INACTIVE', showsOnHomepage: false, hiddenReason: 'INACTIVE' }),
      activity(3, { showsOnHomepage: false, hiddenReason: 'VENDOR_DELETED', vendor: { id: 'v2', businessNameEn: 'Old Co', status: 'ACTIVE', deleted: true } }),
    ]);
    await screen.findByText('Listing 1');
    const badges = screen.getAllByText('Not shown on homepage');
    expect(badges).toHaveLength(2);
    expect(screen.getByText('· The listing is not active')).toBeInTheDocument();
    expect(screen.getByText('· The vendor was deleted')).toBeInTheDocument();
  });

  it('draws the "Only the first 20" line after #20 when more than 20 are featured', async () => {
    renderPage(Array.from({ length: 22 }, (_, i) => activity(i + 1)));
    await screen.findByText('Listing 22');
    const line = screen.getByTestId('featured-limit-line');
    expect(line).toHaveTextContent(`Only the first ${HOMEPAGE_FEATURED_LIMIT} show on the homepage`);
    const items = screen.getAllByRole('listitem');
    const idx = items.indexOf(line);
    expect(items[idx - 1]).toHaveAttribute('data-position', '20');
    expect(items[idx + 1]).toHaveAttribute('data-position', '21');
  });

  it('exactly 20 featured: no line', async () => {
    renderPage(Array.from({ length: 20 }, (_, i) => activity(i + 1)));
    await screen.findByText('Listing 20');
    expect(screen.queryByTestId('featured-limit-line')).not.toBeInTheDocument();
  });

  it('Remove asks first, unfeatures through the star endpoint, drops the row and keeps unsaved moves', async () => {
    renderPage([activity(1), activity(2), activity(3)]);
    await screen.findByText('Listing 1');
    fireEvent.click(screen.getByRole('button', { name: 'Move "Listing 3" up' })); // unsaved move: 1, 3, 2
    expect(titlesOnScreen()).toEqual(['Listing 1', 'Listing 3', 'Listing 2']);

    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remove "Listing 1" from featured' }));
    expect(api.patch).not.toHaveBeenCalled();
    expect(titlesOnScreen()).toEqual(['Listing 1', 'Listing 3', 'Listing 2']);

    api.patch.mockResolvedValue({ data: { id: activity(1).id, titleEn: 'Listing 1', isFeatured: false } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove "Listing 1" from featured' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(`/admin/activities/${activity(1).id}/feature`));
    await waitFor(() => expect(screen.queryByText('Listing 1')).not.toBeInTheDocument());
    expect(titlesOnScreen()).toEqual(['Listing 3', 'Listing 2']); // the unsaved move survived
    expect(toast).toHaveBeenCalledWith('"Listing 1" removed from featured');
    expect(saveButton()).toBeEnabled(); // 3,2 still differs from the loaded 2,3

    api.put.mockResolvedValue({ data: { updated: 2 } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/admin/activities/featured/order', { ids: [activity(3).id, activity(2).id] }));
  });

  it('a 409 from Save shows the server message and keeps the unsaved order on screen', async () => {
    renderPage([activity(1), activity(2)]);
    await screen.findByText('Listing 1');
    fireEvent.click(screen.getByRole('button', { name: 'Move "Listing 1" down' }));
    api.put.mockRejectedValue({ response: { status: 409, data: { message: 'The featured list changed. Reload and try again.' } } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(toast).toHaveBeenCalledWith('The featured list changed. Reload and try again.', 'error'));
    expect(titlesOnScreen()).toEqual(['Listing 2', 'Listing 1']);
    expect(saveButton()).toBeEnabled();
  });

  it('empty state links to Activities', async () => {
    renderPage([]);
    await screen.findByText(/no featured listings/i);
    expect(saveButton()).toBeDisabled();
  });
});
