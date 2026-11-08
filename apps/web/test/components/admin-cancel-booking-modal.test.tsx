import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CancelBookingModal,
  canAdminCancelBooking,
  paidAmount,
  pointsReturned,
  amountPaidLabel,
  formatBookingDate,
  type CancelableBooking,
} from '../../src/app/admin/bookings/_components/cancel-booking-modal';

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
  it('offers the action for pending and confirmed bookings only', () => {
    expect(canAdminCancelBooking({ status: 'PENDING' })).toBe(true);
    expect(canAdminCancelBooking({ status: 'CONFIRMED' })).toBe(true);
    expect(canAdminCancelBooking({ status: 'COMPLETED' })).toBe(false);
    expect(canAdminCancelBooking({ status: 'CANCELLED' })).toBe(false);
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
    expect(screen.getByText(/refunded to the customer as Wanasa points, not to their card/)).toBeInTheDocument();
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
    expect(screen.getByText(/The paid amount \(QAR 405\) is refunded to the customer as Wanasa points/)).toBeInTheDocument();
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

  it('confirms with the booking id and dismisses with "Keep booking"', async () => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();
    render(<CancelBookingModal booking={booking} pending={false} onConfirm={onConfirm} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    expect(onConfirm).toHaveBeenCalledWith('b-1');
    await userEvent.click(screen.getByRole('button', { name: 'Keep booking' }));
    expect(onClose).toHaveBeenCalledTimes(1);
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
