import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CancelBookingModal,
  canAdminCancelBooking,
  bookingHasStarted,
  nowInQatarAsUtc,
  paidAmount,
  pointsReturned,
  amountPaidLabel,
  formatBookingDate,
  type CancelableBooking,
} from '../../src/app/admin/bookings/_components/cancel-booking-modal';
import { todayInQatar } from '../../src/app/admin/_components/external-refund-fields';

const booking: CancelableBooking = {
  id: 'b-1',
  ref: 'JDWL-ABC12',
  status: 'CONFIRMED',
  startDatetime: '2026-12-20T14:00:00.000Z',
  totalPrice: '500',
  currencyCode: 'QAR',
  pointsRedeemed: 0,
  customer: { fullName: 'Noor Al-Thani' },
  activity: { titleEn: 'Overnight Desert Safari', bookingType: 'DAILY' },
  payment: { amount: '505', status: 'SUCCESS', method: 'CARD' },
};

const pointsOnly: CancelableBooking = {
  ...booking,
  pointsRedeemed: 500,
  payment: { amount: '0', status: 'SUCCESS', method: 'WANASA_POINTS' },
};

describe('canAdminCancelBooking', () => {
  // 09:00Z = 12:00 in Qatar (UTC+3). Booking times are Qatar wall-clock tagged UTC.
  const now = new Date('2026-11-20T09:00:00.000Z');
  const tomorrow14 = '2026-11-21T14:00:00.000Z';

  it('converts "now" to Qatar wall-clock tagged as UTC, like the API', () => {
    expect(nowInQatarAsUtc(now).toISOString()).toBe('2026-11-20T12:00:00.000Z');
  });

  it('future confirmed: allowed', () => {
    expect(canAdminCancelBooking({ status: 'CONFIRMED', startDatetime: tomorrow14 }, now)).toBe(true);
  });

  it('future pending: allowed', () => {
    expect(canAdminCancelBooking({ status: 'PENDING', startDatetime: tomorrow14 }, now)).toBe(true);
  });

  it('later today, not started yet: allowed', () => {
    expect(canAdminCancelBooking({ status: 'CONFIRMED', startDatetime: '2026-11-20T15:00:00.000Z' }, now)).toBe(true);
  });

  it('started earlier today: not allowed (11:00 Qatar is in the past at 12:00 Qatar, even though 11:00Z is after 09:00Z)', () => {
    const b = { status: 'CONFIRMED', startDatetime: '2026-11-20T11:00:00.000Z' };
    expect(bookingHasStarted(b, now)).toBe(true);
    expect(canAdminCancelBooking(b, now)).toBe(false);
  });

  it('past confirmed: not allowed', () => {
    expect(canAdminCancelBooking({ status: 'CONFIRMED', startDatetime: '2026-11-10T14:00:00.000Z' }, now)).toBe(false);
  });

  it('completed and cancelled: never', () => {
    expect(canAdminCancelBooking({ status: 'COMPLETED', startDatetime: tomorrow14 }, now)).toBe(false);
    expect(canAdminCancelBooking({ status: 'CANCELLED', startDatetime: tomorrow14 }, now)).toBe(false);
  });
});

describe('paidAmount / pointsReturned / amountPaidLabel', () => {
  it('counts only a successful cash payment', () => {
    expect(paidAmount({ payment: { amount: '505', status: 'SUCCESS' } })).toBe(505);
    expect(paidAmount({ payment: { amount: '505', status: 'PENDING' } })).toBe(0);
    expect(paidAmount({ payment: null })).toBe(0);
  });

  it('returns redeemed points only when a payment row exists', () => {
    expect(pointsReturned({ payment: { amount: '0', status: 'SUCCESS' }, pointsRedeemed: 500 })).toBe(500);
    expect(pointsReturned({ payment: { amount: '405', status: 'PENDING' }, pointsRedeemed: 100 })).toBe(100);
    expect(pointsReturned({ payment: null, pointsRedeemed: 100 })).toBe(0);
  });

  it('labels cash, points, both, or nothing', () => {
    expect(amountPaidLabel(booking)).toBe('QAR 505');
    expect(amountPaidLabel(pointsOnly)).toBe('500 Wanasa points');
    expect(amountPaidLabel({ ...booking, pointsRedeemed: 100, payment: { amount: '405', status: 'SUCCESS' } })).toBe('QAR 405 + 100 Wanasa points');
    expect(amountPaidLabel({ ...booking, payment: { amount: '505', status: 'PENDING' } })).toBe('Not paid yet');
  });
});

describe('formatBookingDate', () => {
  it('shows the time for hourly bookings and the date only for daily ones', () => {
    expect(formatBookingDate({ startDatetime: '2026-12-20T14:00:00.000Z', activity: { titleEn: '', bookingType: 'HOURLY' } }))
      .toBe('Dec 20, 2026, 14:00');
    expect(formatBookingDate({ startDatetime: '2026-12-20T14:00:00.000Z', activity: { titleEn: '', bookingType: 'DAILY' } }))
      .toBe('Dec 20, 2026');
  });
});

describe('CancelBookingModal', () => {
  it('shows the customer, activity, date and amount paid, and explains the points refund', () => {
    render(<CancelBookingModal booking={booking} pending={false} onConfirm={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Cancel booking' })).toBeInTheDocument();
    expect(screen.getByText('JDWL-ABC12')).toBeInTheDocument();
    expect(screen.getByText('Noor Al-Thani')).toBeInTheDocument();
    expect(screen.getByText('Overnight Desert Safari')).toBeInTheDocument();
    expect(screen.getByText('Dec 20, 2026')).toBeInTheDocument();
    expect(screen.getByText('QAR 505')).toBeInTheDocument();
    expect(screen.getByText(/The QAR 505 paid is credited to the customer's Wanasa balance, not to their card/)).toBeInTheDocument();
    expect(screen.queryByText(/redeemed Wanasa points are returned/)).not.toBeInTheDocument();
  });

  it('a points-only booking: shows the points as the amount paid and says they are returned', () => {
    render(<CancelBookingModal booking={pointsOnly} pending={false} onConfirm={() => {}} onClose={() => {}} />);
    expect(screen.getByText('500 Wanasa points')).toBeInTheDocument();
    expect(screen.queryByText('Not paid yet')).not.toBeInTheDocument();
    expect(screen.getByText(/The 500 redeemed Wanasa points are returned to the customer/)).toBeInTheDocument();
    expect(screen.queryByText(/not to their card/)).not.toBeInTheDocument();
  });

  it('a card + points booking mentions both the cash refund and the returned points', () => {
    render(
      <CancelBookingModal
        booking={{ ...booking, pointsRedeemed: 100, payment: { amount: '405', status: 'SUCCESS', method: 'CARD' } }}
        pending={false}
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('QAR 405 + 100 Wanasa points')).toBeInTheDocument();
    expect(screen.getByText(/The QAR 405 paid is credited to the customer's Wanasa balance/)).toBeInTheDocument();
    expect(screen.getByText(/The 100 redeemed Wanasa points are returned to the customer/)).toBeInTheDocument();
  });

  it('says "Not paid yet" and mentions the failed payment for a pending payment', () => {
    render(
      <CancelBookingModal
        booking={{ ...booking, status: 'PENDING', payment: { amount: '505', status: 'PENDING', method: 'PENDING' } }}
        pending={false}
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Not paid yet')).toBeInTheDocument();
    expect(screen.getByText(/pending payment is marked as failed/)).toBeInTheDocument();
    expect(screen.queryByText(/Wanasa points/)).not.toBeInTheDocument();
  });

  it('paid booking: "Cancel booking" is disabled until a refund option is chosen; points → confirms without externalRefund', async () => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();
    render(<CancelBookingModal booking={booking} pending={false} onConfirm={onConfirm} onClose={onClose} />);
    const confirm = screen.getByRole('button', { name: 'Cancel booking' });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Refund as Wanasa points/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Refund already done outside the website/ })).not.toBeChecked();

    await userEvent.click(screen.getByRole('radio', { name: /Refund as Wanasa points/ }));
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('b-1', undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Keep booking' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('paid booking, refunded outside: requires method/amount/date, validates them, then confirms with externalRefund', async () => {
    const onConfirm = jest.fn();
    render(<CancelBookingModal booking={booking} pending={false} onConfirm={onConfirm} onClose={() => {}} />);
    const confirm = screen.getByRole('button', { name: 'Cancel booking' });
    await userEvent.click(screen.getByRole('radio', { name: /Refund already done outside the website/ }));
    expect(confirm).toBeDisabled(); // method missing
    expect(screen.getByLabelText(/Amount refunded/)).toHaveValue(505); // pre-filled with the cash paid
    expect(screen.getByLabelText(/Refund date/)).toHaveValue(todayInQatar());

    await userEvent.selectOptions(screen.getByLabelText(/Method/), 'CASH');
    expect(confirm).toBeEnabled();
    expect(screen.getByTestId('cancel-refund-outside-summary')).toHaveTextContent('No Wanasa points will be added for the QAR 505. The customer will be told the refund was made by cash.');

    // Amount above the cash paid → disabled with an error; back to valid → enabled.
    await userEvent.clear(screen.getByLabelText(/Amount refunded/));
    await userEvent.type(screen.getByLabelText(/Amount refunded/), '600');
    expect(screen.getByText(/cannot exceed the cash paid \(505\)/)).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/Amount refunded/));
    await userEvent.type(screen.getByLabelText(/Amount refunded/), '505');
    // Future date → disabled; today → enabled.
    await userEvent.clear(screen.getByLabelText(/Refund date/));
    await userEvent.type(screen.getByLabelText(/Refund date/), '2099-01-01');
    expect(screen.getByText(/cannot be in the future/)).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/Refund date/));
    await userEvent.type(screen.getByLabelText(/Refund date/), '2026-11-01');
    await userEvent.type(screen.getByLabelText(/Reference or note/), 'TRF-77');
    expect(confirm).toBeEnabled();

    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('b-1', { method: 'CASH', amount: 505, refundedOn: '2026-11-01', reference: 'TRF-77' });
  });

  it('unpaid and points-only bookings: no refund choice, confirm enabled at once', async () => {
    const onConfirm = jest.fn();
    const { unmount } = render(
      <CancelBookingModal booking={{ ...booking, status: 'PENDING', payment: { amount: '505', status: 'PENDING', method: 'PENDING' } }} pending={false} onConfirm={onConfirm} onClose={() => {}} />,
    );
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel booking' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    expect(onConfirm).toHaveBeenCalledWith('b-1', undefined);
    unmount();

    render(<CancelBookingModal booking={pointsOnly} pending={false} onConfirm={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel booking' })).toBeEnabled();
    expect(screen.getByText(/The 500 redeemed Wanasa points are returned to the customer\./)).toBeInTheDocument();
  });

  it('card + points booking says the redeemed points come back with either option', () => {
    render(
      <CancelBookingModal
        booking={{ ...booking, pointsRedeemed: 100, payment: { amount: '405', status: 'SUCCESS', method: 'CARD' } }}
        pending={false}
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/The 100 redeemed Wanasa points are returned to the customer with either option\./)).toBeInTheDocument();
  });

  it('focuses the safe button and closes on Escape, but not while the request is in flight', async () => {
    const onClose = jest.fn();
    const { rerender } = render(<CancelBookingModal booking={booking} pending={false} onConfirm={() => {}} onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'Keep booking' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<CancelBookingModal booking={booking} pending onConfirm={() => {}} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('locks both buttons while the request is in flight', () => {
    render(<CancelBookingModal booking={booking} pending onConfirm={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Keep booking' })).toBeDisabled();
  });

  it('has no button named exactly "Cancelled" (the status-filter e2e locator)', () => {
    render(<CancelBookingModal booking={booking} pending={false} onConfirm={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /^cancelled$/i })).not.toBeInTheDocument();
  });
});
