import {
  bookingLengthLabel,
  dateChangeSummary,
  formatBookingWindow,
  rescheduleCsvColumns,
  settlementText,
  signedAmount,
  type BookingRescheduleRecord,
} from '../../src/lib/booking-reschedule';

const change: BookingRescheduleRecord = {
  createdAt: '2026-11-23T08:30:00.000Z',
  fromStartDatetime: '2026-12-20T10:00:00.000Z',
  fromEndDatetime: '2026-12-20T12:00:00.000Z',
  toStartDatetime: '2026-12-21T14:00:00.000Z',
  toEndDatetime: '2026-12-21T16:00:00.000Z',
  fromUnitNumber: null,
  toUnitNumber: null,
  priceBefore: '200.00',
  priceAfter: '300.00',
  priceDifference: '100.00',
  settlement: 'PAID_OUTSIDE',
  settlementRef: 'TRF 4471',
  reason: 'Customer asked by phone',
  adminName: 'Ali Admin',
};

describe('formatBookingWindow (booking times are local wall-clock tagged UTC)', () => {
  it('hourly: date and time range', () => {
    expect(formatBookingWindow(change.fromStartDatetime, change.fromEndDatetime, 'HOURLY')).toBe('Sun, 20 Dec 2026, 10:00–12:00');
  });
  it('daily: check-in → check-out with the nights', () => {
    expect(formatBookingWindow('2026-12-20T14:00:00.000Z', '2026-12-22T11:00:00.000Z', 'DAILY')).toBe('Sun, 20 Dec 2026 → Tue, 22 Dec 2026 (2 nights)');
  });
  it('length label', () => {
    expect(bookingLengthLabel(change.fromStartDatetime, change.fromEndDatetime, 'HOURLY')).toBe('2 hours');
    expect(bookingLengthLabel('2026-12-20T10:00:00.000Z', '2026-12-20T11:00:00.000Z', 'HOURLY')).toBe('1 hour');
    expect(bookingLengthLabel('2026-12-20T14:00:00.000Z', '2026-12-21T11:00:00.000Z', 'DAILY')).toBe('1 night');
  });
});

describe('money text', () => {
  it('signed amounts', () => {
    expect(signedAmount(100, 'QAR')).toBe('+QAR 100.00');
    expect(signedAmount('-50', 'QAR')).toBe('−QAR 50.00');
    expect(signedAmount(0, 'QAR')).toBe('QAR 0.00');
  });
  it('settlement line', () => {
    expect(settlementText(change, 'QAR')).toBe('+QAR 100.00 · Paid by the customer outside the website (ref TRF 4471)');
    expect(settlementText({ priceDifference: 0, settlement: null }, 'QAR')).toBe('No price change');
    expect(settlementText({ priceDifference: '-40', settlement: 'WAIVED' }, 'QAR')).toBe('−QAR 40.00 · Waived (no money moved)');
    expect(settlementText({ priceDifference: 10, settlement: null }, 'QAR')).toBe('+QAR 10.00 · Not recorded');
  });
  it('admin row summary names who, when, the old dates, the unit move and the money', () => {
    expect(dateChangeSummary(change, 'HOURLY', 'QAR')).toBe(
      'Moved on Mon, 23 Nov 2026 by Ali Admin: was Sun, 20 Dec 2026, 10:00–12:00 · +QAR 100.00 · Paid by the customer outside the website (ref TRF 4471)',
    );
    expect(dateChangeSummary({ ...change, fromUnitNumber: 1, toUnitNumber: 2 }, 'HOURLY', 'QAR')).toContain(' · unit 1 → 2 · ');
  });
});

describe('rescheduleCsvColumns (payout and bookings exports)', () => {
  it('empty strings when the booking was never moved, so the CSV shape is stable', () => {
    expect(rescheduleCsvColumns(undefined, 'HOURLY', 'QAR')).toEqual({ DateChanged: '', OriginalDates: '', PriceDifference: '', DifferenceSettled: '' });
    expect(rescheduleCsvColumns([], 'DAILY', 'QAR').DateChanged).toBe('');
  });
  it('two changes: latest date, the dates first booked, the summed difference, every settlement oldest first', () => {
    const second: BookingRescheduleRecord = {
      ...change,
      createdAt: '2026-11-25T09:00:00.000Z',
      fromStartDatetime: change.toStartDatetime,
      fromEndDatetime: change.toEndDatetime,
      toStartDatetime: '2026-12-22T09:00:00.000Z',
      toEndDatetime: '2026-12-22T11:00:00.000Z',
      priceBefore: '300.00',
      priceAfter: '260.00',
      priceDifference: '-40.00',
      settlement: 'REFUNDED_OUTSIDE',
      settlementRef: null,
    };
    // API returns newest first; the helper must not depend on that.
    const cols = rescheduleCsvColumns([second, change], 'HOURLY', 'QAR');
    expect(cols.DateChanged).toBe('2026-11-25');
    expect(cols.OriginalDates).toBe('Sun, 20 Dec 2026, 10:00–12:00');
    expect(cols.PriceDifference).toBe('60.00');
    expect(cols.DifferenceSettled).toBe(
      '+QAR 100.00 · Paid by the customer outside the website (ref TRF 4471); −QAR 40.00 · Refunded to the customer outside the website',
    );
  });
});
