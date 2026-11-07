import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CancelBookingModal,
  canAdminCancelBooking,
  paidAmount,
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
  customer: { fullName: 'Noor Al-Thani' },
  activity: { titleEn: 'Overnight Desert Safari', bookingType: 'DAILY' },
  payment: { amount: '505', status: 'SUCCESS' },
};

describe('canAdminCancelBooking', () => {
  it('offers the action for pending and confirmed bookings only', () => {
    expect(canAdminCancelBooking({ status: 'PENDING' })).toBe(true);
    expect(canAdminCancelBooking({ status: 'CONFIRMED' })).toBe(true);
    expect(canAdminCancelBooking({ status: 'COMPLETED' })).toBe(false);
    expect(canAdminCancelBooking({ status: 'CANCELLED' })).toBe(false);
  });
});

describe('paidAmount', () => {
  it('counts only a successful payment', () => {
    expect(paidAmount({ payment: { amount: '505', status: 'SUCCESS' } })).toBe(505);
    expect(paidAmount({ payment: { amount: '505', status: 'PENDING' } })).toBe(0);
    expect(paidAmount({ payment: null })).toBe(0);
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
  });

  it('says "Not paid yet" and mentions the failed payment for a pending payment', () => {
    render(
      <CancelBookingModal
        booking={{ ...booking, status: 'PENDING', payment: { amount: '505', status: 'PENDING' } }}
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
