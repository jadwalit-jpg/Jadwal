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
    const other = await ctx.prisma.user.create({
      data: { fullName: 'Other Customer', email: 'other@test.com', password: '$2b$10$dummy.hash.for.tests.never.used.in.auth', role: 'CUSTOMER', emailVerified: true },
    });
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

    // Points were credited once, not twice.
    const customer = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(Number(customer.loyaltyPoints)).toBe(105);
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
