import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/lib/api-error', () => ({
  getApiError: (e: unknown, fallback?: string) =>
    (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback ?? 'error',
}));
// The real DatePicker is a calendar popover; a plain input is enough to drive the dialog.
jest.mock('@/components/date-picker', () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="New date" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import api from '@/lib/api';
import {
  RescheduleBookingModal,
  canAdminRescheduleBooking,
  rescheduleFormReady,
  settlementChoicesFor,
  type ReschedulableBooking,
  type ReschedulePreviewResult,
} from '../../src/app/admin/bookings/_components/reschedule-booking-modal';

const mockedApi = api as unknown as { get: jest.Mock; post: jest.Mock };

const hourly: ReschedulableBooking = {
  id: 'b-1',
  ref: 'JDWL-ABC12',
  status: 'CONFIRMED',
  startDatetime: '2026-12-20T10:00:00.000Z',
  endDatetime: '2026-12-20T12:00:00.000Z',
  guests: 2,
  currencyCode: 'QAR',
  customer: { fullName: 'Noor Al-Thani' },
  activity: { id: 'act-1', titleEn: 'Desert Tour', bookingType: 'HOURLY' },
};
const daily: ReschedulableBooking = {
  ...hourly,
  id: 'b-2',
  startDatetime: '2026-12-20T14:00:00.000Z',
  endDatetime: '2026-12-22T11:00:00.000Z',
  activity: { id: 'act-2', titleEn: 'Sealine Camp', bookingType: 'DAILY' },
};

const previewSame: ReschedulePreviewResult = {
  bookingId: 'b-1', ref: 'JDWL-ABC12', bookingType: 'HOURLY', guests: 2, currency: 'QAR',
  from: { startDatetime: hourly.startDatetime, endDatetime: hourly.endDatetime, unitNumber: null },
  to: { startDatetime: '2026-12-21T14:00:00.000Z', endDatetime: '2026-12-21T16:00:00.000Z', checkInDate: '2026-12-21', checkOutDate: null, slotTime: '14:00', unitNumber: null },
  nights: null, hours: 2, priceBefore: 200, priceAfter: 200, difference: 0, settlementOptions: [],
};
const previewMore: ReschedulePreviewResult = { ...previewSame, priceAfter: 300, difference: 100, settlementOptions: ['PAID_OUTSIDE', 'WAIVED'] };

const slots = [
  { slotStart: '09:00', slotEnd: '11:00', available: 10, isPast: false, isBlocked: false },
  { slotStart: '14:00', slotEnd: '16:00', available: 10, isPast: false, isBlocked: false },
  { slotStart: '17:00', slotEnd: '19:00', available: 1, isPast: false, isBlocked: false },
];

function renderModal(booking: ReschedulableBooking, props: Partial<{ onClose: () => void; onDone: (m: string) => void }> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onClose = props.onClose ?? jest.fn();
  const onDone = props.onDone ?? jest.fn();
  render(
    <QueryClientProvider client={qc}>
      <RescheduleBookingModal booking={booking} onClose={onClose} onDone={onDone} />
    </QueryClientProvider>,
  );
  return { onClose, onDone };
}

/** Route the mocked GET by URL: open slots for the date, or the preview. */
function mockGets(preview: ReschedulePreviewResult | Error) {
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url.startsWith('/availability/hourly/')) return { data: { slots } };
    if (url.includes('/reschedule-preview')) {
      if (preview instanceof Error) throw preview;
      return { data: preview };
    }
    throw new Error(`unexpected GET ${url}`);
  });
}

beforeEach(() => { mockedApi.get.mockReset(); mockedApi.post.mockReset(); });

describe('canAdminRescheduleBooking', () => {
  const now = new Date('2026-11-20T09:00:00.000Z'); // 12:00 in Qatar
  it('confirmed and not started: allowed', () => {
    expect(canAdminRescheduleBooking({ status: 'CONFIRMED', startDatetime: '2026-11-21T14:00:00.000Z' }, now)).toBe(true);
  });
  it('pending, completed, cancelled: not offered', () => {
    for (const status of ['PENDING', 'COMPLETED', 'CANCELLED']) {
      expect(canAdminRescheduleBooking({ status, startDatetime: '2026-11-21T14:00:00.000Z' }, now)).toBe(false);
    }
  });
  it('started (Qatar time): not offered', () => {
    expect(canAdminRescheduleBooking({ status: 'CONFIRMED', startDatetime: '2026-11-20T11:00:00.000Z' }, now)).toBe(false);
  });
});

describe('rescheduleFormReady', () => {
  it('needs a preview, a reason of 5+ characters and, for a non-zero difference, a settlement', () => {
    expect(rescheduleFormReady({ preview: null, reason: 'Customer asked', settlement: '' })).toBe(false);
    expect(rescheduleFormReady({ preview: previewSame, reason: 'why', settlement: '' })).toBe(false);
    expect(rescheduleFormReady({ preview: previewSame, reason: 'Customer asked', settlement: '' })).toBe(true);
    expect(rescheduleFormReady({ preview: previewMore, reason: 'Customer asked', settlement: '' })).toBe(false);
    expect(rescheduleFormReady({ preview: previewMore, reason: 'Customer asked', settlement: 'WAIVED' })).toBe(true);
  });
  it('settlement choices come from the server', () => {
    expect(settlementChoicesFor(null)).toEqual([]);
    expect(settlementChoicesFor(previewMore)).toEqual(['PAID_OUTSIDE', 'WAIVED']);
  });
});

describe('RescheduleBookingModal', () => {
  it('shows the booking, its current dates and the kept length; Confirm is disabled until a preview', () => {
    renderModal(hourly);
    const dialog = screen.getByRole('dialog', { name: 'Change date' });
    expect(within(dialog).getByText('JDWL-ABC12')).toBeInTheDocument();
    expect(screen.getByTestId('reschedule-current')).toHaveTextContent('Sun, 20 Dec 2026, 10:00–12:00');
    expect(within(dialog).getByText(/2 hours · 2 guests/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Change date' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Check availability and price' })).toBeDisabled();
  });

  it('hourly: picking a date loads the open start times (full ones disabled), then the preview shows the price and no settlement for 0', async () => {
    mockGets(previewSame);
    const user = userEvent.setup();
    renderModal(hourly);
    await user.type(screen.getByLabelText('New date'), '2026-12-21');
    const select = screen.getByLabelText('New start time') as HTMLSelectElement;
    await waitFor(() => expect(within(select).getByRole('option', { name: '14:00' })).toBeInTheDocument());
    expect(mockedApi.get).toHaveBeenCalledWith('/availability/hourly/act-1?date=2026-12-21');
    expect((within(select).getByRole('option', { name: /17:00/ }) as HTMLOptionElement).disabled).toBe(true); // 1 seat left, 2 guests
    await user.selectOptions(select, '14:00');
    await user.click(screen.getByRole('button', { name: 'Check availability and price' }));
    await waitFor(() => expect(screen.getByTestId('reschedule-preview')).toBeInTheDocument());
    expect(mockedApi.get).toHaveBeenCalledWith('/admin/bookings/b-1/reschedule-preview?checkInDate=2026-12-21&slotTime=14%3A00');
    expect(screen.getByTestId('reschedule-difference')).toHaveTextContent('QAR 0.00');
    expect(screen.queryByTestId('reschedule-settlement')).not.toBeInTheDocument();
    // Still disabled: no reason yet.
    const confirm = screen.getByRole('button', { name: 'Change date' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason/), 'Customer asked by phone');
    expect(confirm).toBeEnabled();
  });

  it('a higher price needs a settlement; the POST carries the previewed difference, the settlement and the reference', async () => {
    mockGets(previewMore);
    mockedApi.post.mockResolvedValue({ data: { booking: { id: 'b-1' } } });
    const user = userEvent.setup();
    const { onDone } = renderModal(hourly);
    await user.type(screen.getByLabelText('New date'), '2026-12-21');
    const select = screen.getByLabelText('New start time');
    await waitFor(() => expect(within(select).getByRole('option', { name: '14:00' })).toBeInTheDocument());
    await user.selectOptions(select, '14:00');
    await user.click(screen.getByRole('button', { name: 'Check availability and price' }));
    await waitFor(() => expect(screen.getByTestId('reschedule-settlement')).toBeInTheDocument());
    expect(screen.getByTestId('reschedule-difference')).toHaveTextContent('+QAR 100.00');
    // Only the server's two options; no "refunded" for a higher price.
    expect(screen.getByLabelText('Paid by the customer outside the website')).toBeInTheDocument();
    expect(screen.getByLabelText('Waived (no money moved)')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Refunded/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/Reason/), 'Customer asked by phone');
    const confirm = screen.getByRole('button', { name: 'Change date' });
    expect(confirm).toBeDisabled();
    await user.click(screen.getByLabelText('Paid by the customer outside the website'));
    await user.type(screen.getByLabelText('Reference (optional)'), 'TRF 4471');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
    expect(mockedApi.post).toHaveBeenCalledWith('/admin/bookings/b-1/reschedule', {
      checkInDate: '2026-12-21',
      slotTime: '14:00',
      reason: 'Customer asked by phone',
      expectedDifference: 100,
      settlement: 'PAID_OUTSIDE',
      settlementRef: 'TRF 4471',
    });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Booking JDWL-ABC12 moved to Mon, 21 Dec 2026, 14:00–16:00'));
  });

  it('daily: no time field; the preview is requested with the date only and shows the derived check-out', async () => {
    const stayPreview: ReschedulePreviewResult = {
      ...previewSame, bookingType: 'DAILY', hours: null, nights: 2,
      to: { startDatetime: '2026-12-25T14:00:00.000Z', endDatetime: '2026-12-27T11:00:00.000Z', checkInDate: '2026-12-25', checkOutDate: '2026-12-27', slotTime: null, unitNumber: 2 },
      from: { startDatetime: daily.startDatetime, endDatetime: daily.endDatetime, unitNumber: 1 },
    };
    mockGets(stayPreview);
    const user = userEvent.setup();
    renderModal(daily);
    expect(screen.queryByLabelText('New start time')).not.toBeInTheDocument();
    expect(screen.getByText(/2 nights · 2 guests/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('New date'), '2026-12-25');
    await user.click(screen.getByRole('button', { name: 'Check availability and price' }));
    await waitFor(() => expect(screen.getByTestId('reschedule-preview')).toBeInTheDocument());
    expect(mockedApi.get).toHaveBeenCalledWith('/admin/bookings/b-2/reschedule-preview?checkInDate=2026-12-25');
    expect(screen.getByText('Fri, 25 Dec 2026 → Sun, 27 Dec 2026 (2 nights)')).toBeInTheDocument();
    expect(screen.getByText('1 → 2')).toBeInTheDocument();
  });

  it('a refused preview shows the server message and keeps Confirm disabled; changing the date clears it', async () => {
    mockGets(Object.assign(new Error('x'), { response: { data: { message: 'These dates are fully booked' } } }));
    const user = userEvent.setup();
    renderModal(daily);
    await user.type(screen.getByLabelText('New date'), '2026-12-25');
    await user.click(screen.getByRole('button', { name: 'Check availability and price' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('These dates are fully booked'));
    expect(screen.getByRole('button', { name: 'Change date' })).toBeDisabled();
    await user.clear(screen.getByLabelText('New date'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a refused confirm (409) shows why and drops the preview so the admin checks again', async () => {
    mockGets(previewSame);
    mockedApi.post.mockRejectedValue(Object.assign(new Error('x'), { response: { data: { message: 'This booking changed while you were editing it. Refresh and try again.' } } }));
    const user = userEvent.setup();
    const { onDone } = renderModal(daily);
    await user.type(screen.getByLabelText('New date'), '2026-12-25');
    await user.click(screen.getByRole('button', { name: 'Check availability and price' }));
    await waitFor(() => expect(screen.getByTestId('reschedule-preview')).toBeInTheDocument());
    await user.type(screen.getByLabelText(/Reason/), 'Customer asked by phone');
    await user.click(screen.getByRole('button', { name: 'Change date' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/changed while you were editing/));
    expect(screen.queryByTestId('reschedule-preview')).not.toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('Keep dates closes', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal(hourly);
    await user.click(screen.getByRole('button', { name: 'Keep dates' }));
    expect(onClose).toHaveBeenCalled();
  });
});
