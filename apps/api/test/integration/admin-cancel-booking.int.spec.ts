/**
 * Integration — the admin "Cancel booking" action, through the existing
 * AdminService.updateBookingStatus(…, 'CANCELLED') the admin panel button calls.
 *
 * Pins the behaviour the button relies on, as it exists today:
 *   - the booking becomes CANCELLED with cancelledBy = ADMIN and cancelledAt set;
 *   - the slot is free again in the hourly and calendar availability, and the
 *     availability cache is invalidated;
 *   - a repeat (double-click / retry) is a no-op: still one customer
 *     notification, cancelledAt unchanged;
 *   - the payment provider is never called (no outbound HTTP at all);
 *   - a paid amount is refunded to the customer as Wanasa points (what the
 *     confirmation dialog tells the admin).
 */

import { getTestContext, seedReference } from './_setup';
import { AdminService } from '../../src/admin/admin.service';
import { BookingsService } from '../../src/bookings/bookings.service';
import { NotificationService } from '../../src/common/services/notification.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { makeSessionDenylistMock } from '../mocks/auth-deps.mock';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeServices() {
  const prismaSvc = { client: ctx.prisma } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  // Real NotificationService over a stubbed push sender, so notification rows
  // land in the table and can be counted.
  const webPush = { sendToUser: jest.fn().mockResolvedValue(undefined) } as any;
  const notification = new NotificationService(prismaSvc, webPush);
  const availabilityCache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const refCache = { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any;
  const admin = new AdminService(prismaSvc, notification, loyalty, availabilityCache, refCache, makeSessionDenylistMock() as any);

  const redisLock = { acquire: jest.fn().mockResolvedValue('lock-token'), release: jest.fn().mockResolvedValue(undefined) } as any;
  const configService = {
    get: (k: string, fb?: string) =>
      (({ RESERVATION_WINDOW_MINUTES: '15', BOOKING_MAX_ADVANCE_MONTHS: '6', REDIS_LOCK_TTL_MS: '30000' }) as Record<string, string>)[k] ?? fb,
  } as any;
  const bookings = new BookingsService(
    prismaSvc, { log: jest.fn().mockResolvedValue(undefined) } as any, notification, redisLock,
    configService, loyalty, availabilityCache,
    { sendBookingOtp: jest.fn().mockResolvedValue(undefined) } as any,
    { tryConsume: jest.fn().mockResolvedValue(true) } as any,
    { log: jest.fn() } as any,
  );
  return { admin, bookings, availabilityCache, webPush };
}

function futureDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A confirmed, card-paid booking that fills the seed HOURLY activity (capacity 10) for the 10:00 slot. */
async function makePaidConfirmedBooking(seed: any, date: string, guests = 10) {
  const payment = await ctx.prisma.payment.create({
    data: { amount: 105, currency: 'QAR', status: 'SUCCESS', payoutStatus: 'UNPAID', method: 'CARD', paidAt: new Date(), gatewayTxnId: `TXN-${Math.random().toString(36).slice(2, 10)}` },
  });
  return ctx.prisma.booking.create({
    data: {
      ref: `JDWL-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      customerId: seed.customer.id, vendorId: seed.vendor.id, activityId: seed.activity.id,
      guests, bookingPhone: '+97455123456', guestBreakdown: {},
      startDatetime: new Date(`${date}T10:00:00.000Z`), endDatetime: new Date(`${date}T12:00:00.000Z`),
      totalPrice: 100, serviceFee: 5, currencyCode: 'QAR', commissionPct: 10, commissionAmount: 10,
      status: 'CONFIRMED', paymentId: payment.id,
    },
  });
}

async function makeAdmin() {
  return ctx.prisma.user.create({
    data: { fullName: 'Admin', email: 'admin@test.com', password: 'x', role: 'ADMIN', emailVerified: true },
  });
}

const slotAt = (hourly: any, time: string) => hourly.slots.find((s: any) => s.slotStart === time);

/** A date in next month (day 1 + offset), so a two-night stay never straddles a month boundary. */
function nextMonthDate(dayOffset: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(1 + dayOffset);
  return d.toISOString().slice(0, 10);
}
const monthOf = (date: string) => date.slice(0, 7);
const dayOf = (cal: any, date: string) => cal.days.find((d: any) => d.date === date);

/** Turn the seed activity into a DAILY (per-night) listing: a resort/chalet. */
async function makeDailyActivity(activityId: string, overrides: Record<string, unknown> = {}) {
  await ctx.prisma.activity.update({
    where: { id: activityId },
    data: {
      bookingType: 'DAILY', pricingModel: 'PER_UNIT', pricePerPerson: 400,
      durationValue: null, checkInTime: '14:00', checkOutTime: '11:00',
      capacity: 4, hasUnits: false, unitCount: 0, unitCapacity: 1, activeDays: [],
      ...overrides,
    },
  });
}

/** A confirmed, card-paid DAILY booking: check-in 14:00 on `checkIn`, check-out 11:00 on `checkOut` (what createBooking stores). */
async function makePaidDailyBooking(seed: any, checkIn: string, checkOut: string, guests: number, unitNumber: number | null = null) {
  const payment = await ctx.prisma.payment.create({
    data: { amount: 805, currency: 'QAR', status: 'SUCCESS', payoutStatus: 'UNPAID', method: 'CARD', paidAt: new Date(), gatewayTxnId: `TXN-${Math.random().toString(36).slice(2, 10)}` },
  });
  return ctx.prisma.booking.create({
    data: {
      ref: `JDWL-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      customerId: seed.customer.id, vendorId: seed.vendor.id, activityId: seed.activity.id,
      guests, bookingPhone: '+97455123456', guestBreakdown: {}, unitNumber,
      startDatetime: new Date(`${checkIn}T14:00:00.000Z`), endDatetime: new Date(`${checkOut}T11:00:00.000Z`),
      totalPrice: 800, serviceFee: 5, currencyCode: 'QAR', commissionPct: 10, commissionAmount: 80,
      status: 'CONFIRMED', paymentId: payment.id,
    },
  });
}

async function makeOtherCustomer() {
  return ctx.prisma.user.create({
    data: { fullName: 'Other Customer', email: 'other@test.com', password: '$2b$10$dummy.hash.for.tests.never.used.in.auth', role: 'CUSTOMER', emailVerified: true },
  });
}

const refundLedger = (bookingId: string) => ctx.prisma.loyaltyLedger.findMany({ where: { bookingId }, orderBy: { createdAt: 'asc' } });

describe('admin cancel booking (existing status endpoint)', () => {
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => { fetchSpy = jest.spyOn(global, 'fetch' as any); });
  afterEach(() => { fetchSpy.mockRestore(); });

  test('cancels, stamps ADMIN + cancelledAt, frees the slot, invalidates the cache, never calls out', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = await makeAdmin();
    const { admin: adminSvc, bookings, availabilityCache } = makeServices();
    const date = futureDate(10);
    const booking = await makePaidConfirmedBooking(seed, date);

    // Taken before: the 10:00 slot is full and the calendar day shows the guests.
    const beforeHourly = await bookings.getHourlyAvailability(seed.activity.id, date);
    expect(slotAt(beforeHourly, '10:00').available).toBe(0);
    const beforeCal: any = await bookings.getCalendarAvailability(seed.activity.id, date.slice(0, 7));
    expect(beforeCal.days.find((d: any) => d.date === date).booked).toBe(10);

    const result: any = await adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED');
    expect(result.status).toBe('CANCELLED');

    const after = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.status).toBe('CANCELLED');
    expect(after.cancelledBy).toBe('ADMIN');
    expect(after.cancelledAt).toBeInstanceOf(Date);
    expect(after.refundDecisionBy).toBe(admin.id);

    // Free again.
    const afterHourly = await bookings.getHourlyAvailability(seed.activity.id, date);
    expect(slotAt(afterHourly, '10:00').available).toBe(10);
    const afterCal: any = await bookings.getCalendarAvailability(seed.activity.id, date.slice(0, 7));
    expect(afterCal.days.find((d: any) => d.date === date).booked).toBe(0);
    expect(availabilityCache.invalidate).toHaveBeenCalledWith(seed.activity.id);

    // No outbound HTTP: the payment provider is never contacted.
    expect(fetchSpy).not.toHaveBeenCalled();

    // Existing refund rule the dialog describes: paid amount → Wanasa points, payment REFUNDED.
    const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: booking.paymentId! } });
    expect(payment.status).toBe('REFUNDED');
    expect(Number(payment.refundAmount)).toBe(105);
    const customer = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(Number(customer.loyaltyPoints)).toBe(105);
  });

  test('the freed slot can be booked again by another customer', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = await makeAdmin();
    const { admin: adminSvc, bookings } = makeServices();
    const date = futureDate(12);
    const booking = await makePaidConfirmedBooking(seed, date); // fills all 10 seats
    // A different customer, so the pre-cancel rejection is the capacity check,
    // not the "you already have a booking for this slot" guard.
    const other = await makeOtherCustomer();
    const attempt = () => bookings.createBooking(other.id, {
      activityId: seed.activity.id, checkInDate: date, slotTime: '10:00', guests: 1, bookingPhone: '+97455123456',
    } as any);

    await expect(attempt()).rejects.toThrow(/fully booked/i);

    await adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED');

    const res: any = await attempt();
    expect(res.booking.status).toBe('PENDING');
    const created = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: res.booking.id } });
    expect(created.customerId).toBe(other.id);
  });

  test('a repeat cancel is a no-op: one customer notification, cancelledAt unchanged', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = await makeAdmin();
    const { admin: adminSvc, webPush } = makeServices();
    const booking = await makePaidConfirmedBooking(seed, futureDate(14));

    await adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED');
    const first = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });

    // Double-click / retry.
    const again: any = await adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED');
    expect(again.status).toBe('CANCELLED');
    const second = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(second.cancelledAt?.getTime()).toBe(first.cancelledAt?.getTime());

    const cancelledNotes = await ctx.prisma.notification.findMany({
      where: { userId: seed.customer.id, type: 'BOOKING_CANCELLED' },
    });
    expect(cancelledNotes).toHaveLength(1);
    expect(cancelledNotes[0].message).toContain(booking.ref);
    // Every notification row goes out as one push; the second call added none.
    expect(webPush.sendToUser).toHaveBeenCalledTimes(await ctx.prisma.notification.count({ where: { userId: seed.customer.id } }));

    // Credited once, not twice: balance still 105 after the second call, one
    // refund on the payment, one ledger credit for this booking.
    const customer = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(Number(customer.loyaltyPoints)).toBe(105);
    const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: booking.paymentId! } });
    expect(payment.status).toBe('REFUNDED');
    expect(Number(payment.refundAmount)).toBe(105);
    const ledger = await refundLedger(booking.id);
    expect(ledger).toHaveLength(1);
    expect(Number(ledger[0].delta)).toBe(105);
  });

  test('two cancels fired at the same time: cancelled once, one notification, refunded once, credited once', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = await makeAdmin();
    const { admin: adminSvc, availabilityCache } = makeServices();
    const booking = await makePaidConfirmedBooking(seed, futureDate(15));

    const results = await Promise.allSettled([
      adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED'),
      adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED'),
    ]);
    // Both calls resolve: the loser of the claim returns the already-cancelled row.
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    for (const r of results) expect((r as PromiseFulfilledResult<any>).value.status).toBe('CANCELLED');

    const after = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.status).toBe('CANCELLED');
    expect(after.cancelledBy).toBe('ADMIN');

    const notes = await ctx.prisma.notification.findMany({ where: { userId: seed.customer.id, type: 'BOOKING_CANCELLED' } });
    expect(notes).toHaveLength(1);

    const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: booking.paymentId! } });
    expect(payment.status).toBe('REFUNDED');
    expect(Number(payment.refundAmount)).toBe(105);

    const customer = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(Number(customer.loyaltyPoints)).toBe(105);
    expect(await refundLedger(booking.id)).toHaveLength(1);
    expect(availabilityCache.invalidate).toHaveBeenCalledTimes(1);
  });

  test('card + Wanasa points booking: the card amount comes back as points plus the redeemed points, once', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = await makeAdmin();
    const { admin: adminSvc } = makeServices();
    // QAR 500 trip: 100 paid with points (already debited at booking time), 405 by card (400 + 5 fee).
    const payment = await ctx.prisma.payment.create({
      data: { amount: 405, currency: 'QAR', status: 'SUCCESS', payoutStatus: 'UNPAID', method: 'CARD', paidAt: new Date(), gatewayTxnId: 'TXN-MIXED-1' },
    });
    const date = futureDate(17);
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-MIXED1', customerId: seed.customer.id, vendorId: seed.vendor.id, activityId: seed.activity.id,
        guests: 5, bookingPhone: '+97455123456', guestBreakdown: {},
        startDatetime: new Date(`${date}T10:00:00.000Z`), endDatetime: new Date(`${date}T12:00:00.000Z`),
        totalPrice: 500, serviceFee: 5, currencyCode: 'QAR', commissionPct: 10, commissionAmount: 50,
        pointsRedeemed: 100, pointsDiscount: 100,
        status: 'CONFIRMED', paymentId: payment.id,
      },
    });
    const before = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(Number(before.loyaltyPoints)).toBe(0);

    await adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED');

    const pay = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(pay.status).toBe('REFUNDED');
    expect(Number(pay.refundAmount)).toBe(405);
    const customer = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(Number(customer.loyaltyPoints)).toBe(505); // 405 card refund as points + 100 redeemed points back
    const ledger = await refundLedger(booking.id);
    expect(ledger.map((l) => Number(l.delta)).sort((a, b) => a - b)).toEqual([100, 405]);

    // Repeat: nothing moves again.
    await adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED');
    const again = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(Number(again.loyaltyPoints)).toBe(505);
    expect(await refundLedger(booking.id)).toHaveLength(2);
  });

  test('an unpaid pending booking: cancelled, pending payment marked failed, no points', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = await makeAdmin();
    const { admin: adminSvc } = makeServices();
    const payment = await ctx.prisma.payment.create({
      data: { amount: 105, currency: 'QAR', status: 'PENDING', payoutStatus: 'UNPAID', method: 'PENDING' },
    });
    const date = futureDate(16);
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-PEND1', customerId: seed.customer.id, vendorId: seed.vendor.id, activityId: seed.activity.id,
        guests: 2, bookingPhone: '+97455123456', guestBreakdown: {},
        startDatetime: new Date(`${date}T10:00:00.000Z`), endDatetime: new Date(`${date}T12:00:00.000Z`),
        totalPrice: 100, serviceFee: 5, currencyCode: 'QAR', commissionPct: 10, commissionAmount: 10,
        status: 'PENDING', paymentId: payment.id, reservedUntil: new Date(Date.now() + 30 * 60_000),
      },
    });

    await adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED');

    const after = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.status).toBe('CANCELLED');
    expect(after.cancelledBy).toBe('ADMIN');
    const pay = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(pay.status).toBe('FAILED');
    const customer = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(Number(customer.loyaltyPoints)).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('DAILY (per-night) listings', () => {
  test('2-night chalet booking: nights booked before, free after, and another customer can book them', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = await makeAdmin();
    const { admin: adminSvc, bookings, availabilityCache } = makeServices();
    await makeDailyActivity(seed.activity.id); // capacity 4 guests per night, no units
    const checkIn = nextMonthDate(5);
    const night2 = nextMonthDate(6);
    const checkOut = nextMonthDate(7);
    const booking = await makePaidDailyBooking(seed, checkIn, checkOut, 4); // fills both nights
    const other = await makeOtherCustomer();
    const attempt = () => bookings.createBooking(other.id, {
      activityId: seed.activity.id, checkInDate: checkIn, checkOutDate: checkOut, guests: 1, bookingPhone: '+97455123456',
    } as any);

    // Before: the calendar the booking page reads shows both nights full; the checkout day is untouched.
    const calBefore: any = await bookings.getCalendarAvailability(seed.activity.id, monthOf(checkIn));
    for (const night of [checkIn, night2]) {
      expect(dayOf(calBefore, night)).toMatchObject({ booked: 4, available: 0, isFullyBooked: true });
    }
    expect(dayOf(calBefore, checkOut).booked).toBe(0);
    const dailyBefore: any = await bookings.getDailyAvailability(seed.activity.id, checkIn, checkOut);
    expect(dailyBefore).toMatchObject({ booked: 4, available: 0 });
    await expect(attempt()).rejects.toThrow(/fully booked/i);

    await adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED');
    expect(availabilityCache.invalidate).toHaveBeenCalledWith(seed.activity.id);

    // After: both nights free again, and the other customer gets them.
    const calAfter: any = await bookings.getCalendarAvailability(seed.activity.id, monthOf(checkIn));
    for (const night of [checkIn, night2]) {
      expect(dayOf(calAfter, night)).toMatchObject({ booked: 0, available: 4, isFullyBooked: false });
    }
    const dailyAfter: any = await bookings.getDailyAvailability(seed.activity.id, checkIn, checkOut);
    expect(dailyAfter).toMatchObject({ booked: 0, available: 4 });
    const res: any = await attempt();
    expect(res.booking.status).toBe('PENDING');
    const created = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: res.booking.id } });
    expect(created.customerId).toBe(other.id);
    expect(created.startDatetime.toISOString()).toBe(`${checkIn}T14:00:00.000Z`);
    expect(created.endDatetime.toISOString()).toBe(`${checkOut}T11:00:00.000Z`);
  });

  test('2-night booking on a listing with units: the free unit count goes back up by one', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = await makeAdmin();
    const { admin: adminSvc, bookings } = makeServices();
    await makeDailyActivity(seed.activity.id, { hasUnits: true, unitCount: 2, unitCapacity: 4, capacity: 8 });
    const checkIn = nextMonthDate(10);
    const night2 = nextMonthDate(11);
    const checkOut = nextMonthDate(12);
    const booking = await makePaidDailyBooking(seed, checkIn, checkOut, 2, 1); // unit 1 of 2

    const freeUnits = (daily: any) => daily.units.filter((u: any) => u.available > 0).length;

    // Before: 1 of 2 units free on both nights.
    const calBefore: any = await bookings.getCalendarAvailability(seed.activity.id, monthOf(checkIn));
    for (const night of [checkIn, night2]) {
      expect(dayOf(calBefore, night)).toMatchObject({ capacity: 2, booked: 1, available: 1 });
    }
    expect(freeUnits(await bookings.getDailyAvailability(seed.activity.id, checkIn, checkOut))).toBe(1);

    await adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED');

    // After: both units free.
    const calAfter: any = await bookings.getCalendarAvailability(seed.activity.id, monthOf(checkIn));
    for (const night of [checkIn, night2]) {
      expect(dayOf(calAfter, night)).toMatchObject({ capacity: 2, booked: 0, available: 2 });
    }
    expect(freeUnits(await bookings.getDailyAvailability(seed.activity.id, checkIn, checkOut))).toBe(2);

    // And the nights can be booked again (a unit is assigned).
    const other = await makeOtherCustomer();
    const res: any = await bookings.createBooking(other.id, {
      activityId: seed.activity.id, checkInDate: checkIn, checkOutDate: checkOut, guests: 2, bookingPhone: '+97455123456',
    } as any);
    expect(res.booking.status).toBe('PENDING');
    const created = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: res.booking.id } });
    expect(created.unitNumber).not.toBeNull();
  });
});
