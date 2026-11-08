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
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { todayIn } from '../../src/common/refunds/external-refund';

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
  // BookingsService writes its audit rows through this (mocked) logger.
  const bookingsAudit = { log: jest.fn().mockResolvedValue(undefined) };
  const bookings = new BookingsService(
    prismaSvc, bookingsAudit as any, notification, redisLock,
    configService, loyalty, availabilityCache,
    { sendBookingOtp: jest.fn().mockResolvedValue(undefined) } as any,
    { tryConsume: jest.fn().mockResolvedValue(true) } as any,
    { log: jest.fn() } as any,
  );
  return { admin, bookings, availabilityCache, webPush, bookingsAudit };
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

// ─────────────────────────────────────────────────────────────────────────────
// "Refund already done outside the website" — externalRefund on the admin
// cancel and on the admin approve in the refund queue.
// ─────────────────────────────────────────────────────────────────────────────
describe('outside refund (externalRefund)', () => {
  const OUTSIDE = (over: Record<string, unknown> = {}) => ({
    method: 'BANK_TRANSFER' as const, amount: 105, refundedOn: '2026-11-01', reference: 'TRF-123', ...over,
  });
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => { fetchSpy = jest.spyOn(global, 'fetch' as any); });
  afterEach(() => { fetchSpy.mockRestore(); });

  test('card-paid HOURLY booking: payment REFUNDED with method/amount/date, no points, slot freed, EN notification, audit row', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = await makeAdmin();
    const { admin: adminSvc, bookings, availabilityCache } = makeServices();
    const date = futureDate(11);
    const booking = await makePaidConfirmedBooking(seed, date);
    expect(slotAt(await bookings.getHourlyAvailability(seed.activity.id, date), '10:00').available).toBe(0);

    const result: any = await adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED', OUTSIDE());
    expect(result.status).toBe('CANCELLED');

    const after = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.status).toBe('CANCELLED');
    expect(after.cancelledBy).toBe('ADMIN');
    expect(after.refundDecisionActor).toBe('ADMIN');
    expect(after.refundDecisionBy).toBe(admin.id);
    expect(after.refundDecisionNote).toBe('Refunded outside the website: QAR 105 by Bank transfer on 1 Nov 2026. Ref: TRF-123');

    const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: booking.paymentId! } });
    expect(payment.status).toBe('REFUNDED');
    expect(Number(payment.refundAmount)).toBe(105);
    expect(payment.refundMethod).toBe('BANK_TRANSFER');
    expect(payment.refundedAt?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(payment.bankTransferRef).toBeNull(); // vendor-payout field, untouched

    // No Wanasa points for the cash, no ledger row.
    const customer = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(Number(customer.loyaltyPoints)).toBe(0);
    expect(await refundLedger(booking.id)).toHaveLength(0);

    // Slot freed and cache invalidated, as for any cancel.
    expect(slotAt(await bookings.getHourlyAvailability(seed.activity.id, date), '10:00').available).toBe(10);
    expect(availabilityCache.invalidate).toHaveBeenCalledWith(seed.activity.id);
    expect(fetchSpy).not.toHaveBeenCalled();

    // One notification, English, no mention of Wanasa points.
    const notes = await ctx.prisma.notification.findMany({ where: { userId: seed.customer.id, type: 'BOOKING_CANCELLED' } });
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('Your booking was cancelled');
    expect(notes[0].message).toBe(
      `Booking ${booking.ref} for "Sample Tour" was cancelled by AL Jadwal support. Your refund of QAR 105 was made by bank transfer on 1 Nov 2026.`,
    );
    expect(notes[0].message).not.toMatch(/Wanasa/i);

    // Durable audit row with the outside-refund details.
    const audit = await ctx.prisma.auditLog.findFirst({ where: { entityId: booking.id, action: 'BOOKING_CANCELLED_REFUND_OUTSIDE' } });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(admin.id);
    expect(audit!.actionCategory).toBe('FINANCIAL');
    const details = JSON.parse(audit!.details ?? '{}');
    expect(details).toMatchObject({ refundedOutside: true, method: 'BANK_TRANSFER', amount: 105, refundedOn: '2026-11-01', reference: 'TRF-123', cashPaid: 105 });
  });

  test('Arabic customer: the notification uses the Arabic text, method and activity title', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = await makeAdmin();
    const { admin: adminSvc } = makeServices();
    await ctx.prisma.user.update({ where: { id: seed.customer.id }, data: { preferredLanguage: 'AR' } });
    await ctx.prisma.activity.update({ where: { id: seed.activity.id }, data: { titleAr: 'جولة تجريبية' } });
    const booking = await makePaidConfirmedBooking(seed, futureDate(13));

    await adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED', OUTSIDE({ method: 'CASH', amount: 100, refundedOn: '2026-10-05' }));

    const notes = await ctx.prisma.notification.findMany({ where: { userId: seed.customer.id, type: 'BOOKING_CANCELLED' } });
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('تم إلغاء حجزك');
    expect(notes[0].message).toBe(
      `تم إلغاء حجزك رقم ${booking.ref} (جولة تجريبية) من فريق الجدول، وتم رد مبلغ 100 ر.ق لك عن طريق نقداً بتاريخ 5 أكتوبر 2026.`,
    );
  });

  test('DAILY 2-night booking with an outside refund: nights freed, another customer books them, no points', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = await makeAdmin();
    const { admin: adminSvc, bookings } = makeServices();
    await makeDailyActivity(seed.activity.id);
    const checkIn = nextMonthDate(14), night2 = nextMonthDate(15), checkOut = nextMonthDate(16);
    const booking = await makePaidDailyBooking(seed, checkIn, checkOut, 4);
    const other = await makeOtherCustomer();
    const attempt = () => bookings.createBooking(other.id, {
      activityId: seed.activity.id, checkInDate: checkIn, checkOutDate: checkOut, guests: 1, bookingPhone: '+97455123456',
    } as any);
    await expect(attempt()).rejects.toThrow(/fully booked/i);

    await adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED', OUTSIDE({ method: 'CARD_PAY2M', amount: 805 }));

    const cal: any = await bookings.getCalendarAvailability(seed.activity.id, monthOf(checkIn));
    for (const night of [checkIn, night2]) expect(dayOf(cal, night)).toMatchObject({ booked: 0, available: 4 });
    const res: any = await attempt();
    expect(res.booking.status).toBe('PENDING');
    const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: booking.paymentId! } });
    expect(payment).toMatchObject({ status: 'REFUNDED', refundMethod: 'CARD_PAY2M' });
    expect(Number(payment.refundAmount)).toBe(805);
    const customer = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(Number(customer.loyaltyPoints)).toBe(0);
  });

  test('card + Wanasa points booking: redeemed points returned once, cash not credited', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = await makeAdmin();
    const { admin: adminSvc } = makeServices();
    const payment = await ctx.prisma.payment.create({
      data: { amount: 405, currency: 'QAR', status: 'SUCCESS', payoutStatus: 'UNPAID', method: 'CARD', paidAt: new Date(), gatewayTxnId: 'TXN-MIXED-OUT' },
    });
    const date = futureDate(18);
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-MIXOUT', customerId: seed.customer.id, vendorId: seed.vendor.id, activityId: seed.activity.id,
        guests: 5, bookingPhone: '+97455123456', guestBreakdown: {},
        startDatetime: new Date(`${date}T10:00:00.000Z`), endDatetime: new Date(`${date}T12:00:00.000Z`),
        totalPrice: 500, serviceFee: 5, currencyCode: 'QAR', commissionPct: 10, commissionAmount: 50,
        pointsRedeemed: 100, pointsDiscount: 100, status: 'CONFIRMED', paymentId: payment.id,
      },
    });

    await adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED', OUTSIDE({ amount: 405 }));
    await adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED', OUTSIDE({ amount: 405 })); // repeat

    const customer = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(Number(customer.loyaltyPoints)).toBe(100); // only the redeemed points came back
    const ledger = await refundLedger(booking.id);
    expect(ledger).toHaveLength(1);
    expect(Number(ledger[0].delta)).toBe(100);
    const pay = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(pay).toMatchObject({ status: 'REFUNDED', refundMethod: 'BANK_TRANSFER' });
    expect(Number(pay.refundAmount)).toBe(405);
  });

  test('repeat and simultaneous outside-refund cancels: cancelled once, one notification, never any points', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = await makeAdmin();
    const { admin: adminSvc } = makeServices();
    const booking = await makePaidConfirmedBooking(seed, futureDate(19));

    const results = await Promise.allSettled([
      adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED', OUTSIDE()),
      adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED', OUTSIDE()),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    await adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED', OUTSIDE()); // and once more, later

    expect(await ctx.prisma.notification.count({ where: { userId: seed.customer.id, type: 'BOOKING_CANCELLED' } })).toBe(1);
    const customer = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(Number(customer.loyaltyPoints)).toBe(0);
    expect(await refundLedger(booking.id)).toHaveLength(0);
    const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: booking.paymentId! } });
    expect(payment.status).toBe('REFUNDED');
    expect(Number(payment.refundAmount)).toBe(105);
    expect(await ctx.prisma.auditLog.count({ where: { entityId: booking.id, action: 'BOOKING_CANCELLED_REFUND_OUTSIDE' } })).toBe(1);
  });

  test('an outside refund sent after a points cancel is refused (409) and changes nothing: no double refund hidden behind a 200', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = await makeAdmin();
    const { admin: adminSvc } = makeServices();
    const booking = await makePaidConfirmedBooking(seed, futureDate(29));

    // Someone else (another admin, a stale tab) cancels first, the ordinary way: cash → Wanasa points.
    await adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED');
    expect(Number((await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } })).loyaltyPoints)).toBe(105);

    // The admin who already sent the bank transfer now records it: must NOT look like success.
    await expect(adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED', OUTSIDE()))
      .rejects.toThrow(ConflictException);
    await expect(adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED', OUTSIDE()))
      .rejects.toThrow(/refunded as Wanasa points/);

    const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: booking.paymentId! } });
    expect(payment).toMatchObject({ status: 'REFUNDED', refundMethod: null });
    const after = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.refundDecisionNote).toBeNull();
    expect(Number((await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } })).loyaltyPoints)).toBe(105);
    expect(await refundLedger(booking.id)).toHaveLength(1);
    expect(await ctx.prisma.notification.count({ where: { userId: seed.customer.id, type: 'BOOKING_CANCELLED' } })).toBe(1);
    expect(await ctx.prisma.auditLog.count({ where: { entityId: booking.id, action: 'BOOKING_CANCELLED_REFUND_OUTSIDE' } })).toBe(0);
  });

  test('regression: a cancel WITHOUT externalRefund still credits the cash as Wanasa points', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = await makeAdmin();
    const { admin: adminSvc } = makeServices();
    const booking = await makePaidConfirmedBooking(seed, futureDate(21));
    await adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED');
    const customer = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(Number(customer.loyaltyPoints)).toBe(105);
    const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: booking.paymentId! } });
    expect(payment.refundMethod).toBeNull();
    const note = await ctx.prisma.notification.findFirst({ where: { userId: seed.customer.id, type: 'BOOKING_CANCELLED' } });
    expect(note!.message).toMatch(/refunded as Wanasa points/);
  });

  test('vendor payout already PAID: the clawback alert is still raised', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = await makeAdmin();
    const { admin: adminSvc } = makeServices();
    const booking = await makePaidConfirmedBooking(seed, futureDate(22));
    await ctx.prisma.payment.update({ where: { id: booking.paymentId! }, data: { payoutStatus: 'PAID' } });

    await adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED', OUTSIDE());

    // notifyAdmins is fire-and-forget after the commit; give it a moment.
    let alert = null as Awaited<ReturnType<typeof ctx.prisma.notification.findFirst>>;
    for (let i = 0; i < 40 && !alert; i++) {
      alert = await ctx.prisma.notification.findFirst({ where: { userId: admin.id, title: 'Payout clawback needed' } });
      if (!alert) await new Promise((r) => setTimeout(r, 50));
    }
    expect(alert).not.toBeNull();
    expect(alert!.message).toContain(booking.ref);
    expect(alert!.message).toContain('105');
  });

  describe('rejected with 400', () => {
    test('with a status other than CANCELLED', async () => {
      const seed = await seedReference(ctx.prisma);
      const admin = await makeAdmin();
      const { admin: adminSvc } = makeServices();
      const booking = await makePaidConfirmedBooking(seed, futureDate(23));
      await expect(adminSvc.updateBookingStatus(admin.id, booking.id, 'COMPLETED', OUTSIDE())).rejects.toThrow(BadRequestException);
      expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CONFIRMED');
    });

    test('on an unpaid (pending payment) booking', async () => {
      const seed = await seedReference(ctx.prisma);
      const admin = await makeAdmin();
      const { admin: adminSvc } = makeServices();
      const payment = await ctx.prisma.payment.create({ data: { amount: 105, currency: 'QAR', status: 'PENDING', payoutStatus: 'UNPAID', method: 'PENDING' } });
      const date = futureDate(24);
      const booking = await ctx.prisma.booking.create({
        data: {
          ref: 'JDWL-UNPD1', customerId: seed.customer.id, vendorId: seed.vendor.id, activityId: seed.activity.id,
          guests: 1, bookingPhone: '+97455123456', guestBreakdown: {},
          startDatetime: new Date(`${date}T10:00:00.000Z`), endDatetime: new Date(`${date}T12:00:00.000Z`),
          totalPrice: 100, serviceFee: 5, currencyCode: 'QAR', commissionPct: 10, commissionAmount: 10,
          status: 'PENDING', paymentId: payment.id, reservedUntil: new Date(Date.now() + 30 * 60_000),
        },
      });
      await expect(adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED', OUTSIDE())).rejects.toThrow(/paid by card/);
      expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('PENDING');
    });

    test('on a points-only booking (synthetic payment of 0)', async () => {
      const seed = await seedReference(ctx.prisma);
      const admin = await makeAdmin();
      const { admin: adminSvc } = makeServices();
      const payment = await ctx.prisma.payment.create({ data: { amount: 0, currency: 'QAR', status: 'SUCCESS', payoutStatus: 'UNPAID', method: 'WANASA_POINTS', paidAt: new Date() } });
      const date = futureDate(25);
      const booking = await ctx.prisma.booking.create({
        data: {
          ref: 'JDWL-PTS1', customerId: seed.customer.id, vendorId: seed.vendor.id, activityId: seed.activity.id,
          guests: 1, bookingPhone: '+97455123456', guestBreakdown: {},
          startDatetime: new Date(`${date}T10:00:00.000Z`), endDatetime: new Date(`${date}T12:00:00.000Z`),
          totalPrice: 100, serviceFee: 0, currencyCode: 'QAR', commissionPct: 10, commissionAmount: 10,
          pointsRedeemed: 100, pointsDiscount: 100, status: 'CONFIRMED', paymentId: payment.id,
        },
      });
      await expect(adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED', OUTSIDE({ amount: 1 }))).rejects.toThrow(/points-only/);
    });

    test('amount above the cash paid', async () => {
      const seed = await seedReference(ctx.prisma);
      const admin = await makeAdmin();
      const { admin: adminSvc } = makeServices();
      const booking = await makePaidConfirmedBooking(seed, futureDate(26));
      await expect(adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED', OUTSIDE({ amount: 105.01 }))).rejects.toThrow(/cannot exceed the cash paid/);
    });

    test('refund date in the future (activity timezone)', async () => {
      const seed = await seedReference(ctx.prisma);
      const admin = await makeAdmin();
      const { admin: adminSvc } = makeServices();
      const booking = await makePaidConfirmedBooking(seed, futureDate(27));
      const tomorrow = new Date(`${todayIn('UTC')}T00:00:00.000Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 2);
      await expect(adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED', OUTSIDE({ refundedOn: tomorrow.toISOString().slice(0, 10) })))
        .rejects.toThrow(/cannot be in the future/);
    });
  });

  describe('refund queue (customer-cancelled, REFUND_PENDING)', () => {
    /** A customer-cancelled, card-paid booking awaiting a refund decision. */
    async function makeRefundPending(seed: any) {
      const payment = await ctx.prisma.payment.create({
        data: { amount: 100, currency: 'QAR', status: 'REFUND_PENDING', payoutStatus: 'UNPAID', method: 'CARD', paidAt: new Date(), refundAmount: 100, gatewayTxnId: `TXN-RQ-${Math.random().toString(36).slice(2, 8)}` },
      });
      const date = futureDate(28);
      return ctx.prisma.booking.create({
        data: {
          ref: `JDWL-RQ${Math.random().toString(36).slice(2, 5).toUpperCase()}`, customerId: seed.customer.id, vendorId: seed.vendor.id, activityId: seed.activity.id,
          guests: 1, bookingPhone: '+97455123456', guestBreakdown: {},
          startDatetime: new Date(`${date}T10:00:00.000Z`), endDatetime: new Date(`${date}T12:00:00.000Z`),
          totalPrice: 95, serviceFee: 5, currencyCode: 'QAR', commissionPct: 10, commissionAmount: 9.5,
          status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: 'CUSTOMER', paymentId: payment.id,
        },
      });
    }

    test('admin approves as refunded outside: payment REFUNDED with the method, no points, outside notification', async () => {
      const seed = await seedReference(ctx.prisma);
      const admin = await makeAdmin();
      const { bookings, bookingsAudit } = makeServices();
      const booking = await makeRefundPending(seed);

      const res: any = await bookings.recordRefundDecision(admin.id, 'ADMIN', booking.id, 'APPROVE', undefined, 'called the customer', OUTSIDE({ method: 'CASH', amount: 100, refundedOn: '2026-11-02' }) as any);
      expect(res.refundPoints).toBe(0);
      expect(res.message).toMatch(/recorded as made by Cash/);

      const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: booking.paymentId! } });
      expect(payment).toMatchObject({ status: 'REFUNDED', refundMethod: 'CASH' });
      expect(Number(payment.refundAmount)).toBe(100);
      expect(payment.refundedAt?.toISOString()).toBe('2026-11-02T00:00:00.000Z');
      const after = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(after.refundDecisionActor).toBe('ADMIN');
      expect(after.refundDecisionNote).toBe('Refunded outside the website: QAR 100 by Cash on 2 Nov 2026. Ref: TRF-123 Note: called the customer');
      const customer = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
      expect(Number(customer.loyaltyPoints)).toBe(0);
      expect(await refundLedger(booking.id)).toHaveLength(0);
      const note = await ctx.prisma.notification.findFirst({ where: { userId: seed.customer.id, type: 'REFUND_DECIDED' } });
      expect(note!.message).toBe(`Your refund of QAR 100 for booking ${booking.ref} ("Sample Tour") was made by cash on 2 Nov 2026.`);
      expect(note!.message).not.toMatch(/Wanasa/i);
      const auditCall = bookingsAudit.log.mock.calls.map((c: any[]) => c[0]).find((a: any) => a.action === 'REFUND_APPROVED_OUTSIDE');
      expect(auditCall).toMatchObject({ actorType: 'ADMIN', actorId: admin.id, entity: 'Booking', entityId: booking.id });
      expect(JSON.parse(auditCall.details)).toMatchObject({ refundedOutside: true, method: 'CASH', refundedOn: '2026-11-02', reference: 'TRF-123', refundAmountQAR: 100, refundPoints: 0 });
    });

    test('a vendor cannot record an outside refund (403), and the request stays pending', async () => {
      const seed = await seedReference(ctx.prisma);
      const { bookings } = makeServices();
      const booking = await makeRefundPending(seed);
      await expect(bookings.recordRefundDecision(seed.vendorUser.id, 'VENDOR', booking.id, 'APPROVE', 100, undefined, OUTSIDE() as any))
        .rejects.toThrow(ForbiddenException);
      const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: booking.paymentId! } });
      expect(payment.status).toBe('REFUND_PENDING');
    });

    test('outside refund with REJECT is a 400', async () => {
      const seed = await seedReference(ctx.prisma);
      const admin = await makeAdmin();
      const { bookings } = makeServices();
      const booking = await makeRefundPending(seed);
      await expect(bookings.recordRefundDecision(admin.id, 'ADMIN', booking.id, 'REJECT', undefined, undefined, OUTSIDE() as any))
        .rejects.toThrow(BadRequestException);
    });

    test('vendor approve as points and reject are unchanged', async () => {
      const seed = await seedReference(ctx.prisma);
      const { bookings } = makeServices();
      const approved = await makeRefundPending(seed);
      const res: any = await bookings.recordRefundDecision(seed.vendorUser.id, 'VENDOR', approved.id, 'APPROVE', 100, undefined);
      expect(res.refundPoints).toBe(100);
      const customer = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
      expect(Number(customer.loyaltyPoints)).toBe(100);
      const pay = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: approved.paymentId! } });
      expect(pay).toMatchObject({ status: 'REFUNDED', refundMethod: null });

      const rejected = await makeRefundPending(seed);
      await bookings.recordRefundDecision(seed.vendorUser.id, 'VENDOR', rejected.id, 'REJECT', undefined, 'no-show');
      const pay2 = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: rejected.paymentId! } });
      expect(pay2.status).toBe('REJECTED');
      expect(Number((await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } })).loyaltyPoints)).toBe(100);
    });
  });
});
