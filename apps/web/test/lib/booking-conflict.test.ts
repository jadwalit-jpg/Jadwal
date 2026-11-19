/**
 * The "you already have a booking for this time slot" 409 from POST /bookings:
 * telling it apart from the other 409s, finding the booking it refers to in
 * the customer's own list, and where the pop-up's button goes.
 */
import { existingBookingHref, findExistingBookingForSlot, isExistingBookingConflict } from '../../src/lib/booking-conflict';

const row = (id: string, activityId: string, status: string, start: string) => ({ id, activityId, status, startDatetime: start });

describe('isExistingBookingConflict', () => {
  it('matches the duplicate guard only', () => {
    expect(isExistingBookingConflict(409, 'You already have a booking for this time slot')).toBe(true);
    expect(isExistingBookingConflict(409, ['You already have a booking for this time slot'])).toBe(true);
    expect(isExistingBookingConflict(409, 'This slot is fully booked')).toBe(false);
    expect(isExistingBookingConflict(409, 'This slot is busy right now. Please try again in a moment.')).toBe(false);
    expect(isExistingBookingConflict(400, 'You already have a booking for this time slot')).toBe(false);
    expect(isExistingBookingConflict(409, undefined)).toBe(false);
  });
});

describe('findExistingBookingForSlot', () => {
  const list = [
    row('newest-other-activity', 'act-2', 'PENDING', '2026-12-20T14:00:00.000Z'),
    row('pending-same-day', 'act-1', 'PENDING', '2026-12-20T14:00:00.000Z'),
    row('pending-other-day', 'act-1', 'PENDING', '2026-12-25T14:00:00.000Z'),
    row('cancelled', 'act-1', 'CANCELLED', '2026-12-20T14:00:00.000Z'),
    row('confirmed-old', 'act-1', 'CONFIRMED', '2026-11-01T14:00:00.000Z'),
  ];
  it('prefers the active booking for this listing on the chosen date', () => {
    expect(findExistingBookingForSlot(list, 'act-1', '2026-12-25')).toBe('pending-other-day');
    expect(findExistingBookingForSlot(list, 'act-1', '2026-12-20')).toBe('pending-same-day');
  });
  it('falls back to the most recent active booking for the listing when the date does not match', () => {
    expect(findExistingBookingForSlot(list, 'act-1', '2027-01-01')).toBe('pending-same-day');
    expect(findExistingBookingForSlot(list, 'act-1', null)).toBe('pending-same-day');
  });
  it('ignores cancelled bookings, other listings and an unknown activity', () => {
    expect(findExistingBookingForSlot([list[3]], 'act-1', '2026-12-20')).toBeNull();
    expect(findExistingBookingForSlot(list, 'act-9', '2026-12-20')).toBeNull();
    expect(findExistingBookingForSlot(list, undefined, '2026-12-20')).toBeNull();
    expect(findExistingBookingForSlot([], 'act-1', '2026-12-20')).toBeNull();
  });
});

describe('existingBookingHref', () => {
  it('opens the booking when known, otherwise My bookings', () => {
    expect(existingBookingHref('b-1')).toBe('/bookings/b-1');
    expect(existingBookingHref(null)).toBe('/bookings');
  });
});
