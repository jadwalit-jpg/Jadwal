/**
 * Integration — the admin "Change date" action (BookingRescheduleService),
 * against a real Postgres.
 *
 *   - preview computes the new window, the price for the new dates with the
 *     same createBooking rules (special prices, pricing model) and the
 *     difference against what the customer was charged, and writes nothing;
 *   - reschedule moves the booking (dates, unit), stamps rescheduledAt, writes
 *     one BookingReschedule row and one FINANCIAL audit row, frees the old slot,
 *     notifies customer and vendor in-app and through the email outbox, and
 *     never touches totalPrice, commissionAmount, serviceFee or payment.amount;
 *   - a price difference must be settled (direction-checked) and the admin's
 *     expected difference must still hold (409 otherwise);
 *   - refusals: not confirmed, started, past date, same dates, closed by a
 *     block, inactive weekday, beyond the advance limit, outside opening hours,
 *     no capacity / no free unit;
 *   - concurrency: one of two concurrent moves of the same booking wins; two
 *     bookings racing for the last unit → exactly one gets it.
 */

import { getTestContext, seedReference } from './_setup';
import { BookingRescheduleService } from '../../src/admin/booking-reschedule.service';
import { BookingsService } from '../../src/bookings/bookings.service';
import { NotificationService } from '../../src/common/services/notification.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { BadRequestException, ConflictException } from '@nestjs/common';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

const ADMIN = { id: 'admin-user-id', name: 'Ali Admin' };

function makeServices() {
  const prismaSvc = { client: ctx.prisma } as any;
  const webPush = { sendToUser: jest.fn().mockResolvedValue(undefined) } as any;
  const notification = new NotificationService(prismaSvc, webPush);
  const availabilityCache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const redisLock = { acquire: jest.fn().mockResolvedValue('lock-token'), release: jest.fn().mockResolvedValue(undefined) } as any;
  const configService = {
    get: (k: string, fb?: string) =>
      (({ RESERVATION_WINDOW_MINUTES: '15', BOOKING_MAX_ADVANCE_MONTHS: '6', REDIS_LOCK_TTL_MS: '30000' }) as Record<string, string>)[k] ?? fb,
  } as any;
  const service = new BookingRescheduleService(prismaSvc, notification, availabilityCache, redisLock, configService);
  const loyalty = new LoyaltyService(prismaSvc);
  const bookings = new BookingsService(
    prismaSvc, { log: jest.fn().mockResolvedValue(undefined) } as any, notification, redisLock,
    configService, loyalty, availabilityCache,
    { sendBookingOtp: jest.fn().mockResolvedValue(undefined) } as any,
    { tryConsume: jest.fn().mockResolvedValue(true) } as any,
    { log: jest.fn() } as any,
  );
  return { service, bookings, availabilityCache, redisLock };
}

function futureDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const iso = (date: string, time: string) => new Date(`${date}T${time}:00.000Z`);

/** A confirmed, card-paid 2-guest booking on the seed HOURLY activity (100/person, 2h): 10:00–12:00 on `date`. */
async function makeHourlyBooking(seed: any, date: string, opts: { guests?: number; start?: string; status?: string; customerId?: string; totalPrice?: number; couponDiscount?: number; selectedExtras?: unknown } = {}) {
  const guests = opts.guests ?? 2;
  const start = opts.start ?? '10:00';
  const endMins = Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + 120;
  const end = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;
  const totalPrice = opts.totalPrice ?? guests * 100;
  const payment = await ctx.prisma.payment.create({
    data: { amount: totalPrice + 5, currency: 'QAR', status: 'SUCCESS', payoutStatus: 'UNPAID', method: 'CARD', paidAt: new Date(), gatewayTxnId: `TXN-${Math.random().toString(36).slice(2, 10)}` },
  });
  return ctx.prisma.booking.create({
    data: {
      ref: `JDWL-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      customerId: opts.customerId ?? seed.customer.id, vendorId: seed.vendor.id, activityId: seed.activity.id,
      guests, bookingPhone: '+97455123456', guestBreakdown: {},
      startDatetime: iso(date, start), endDatetime: iso(date, end),
      totalPrice, serviceFee: 5, currencyCode: 'QAR', commissionPct: 10, commissionAmount: totalPrice / 10,
      couponDiscount: opts.couponDiscount ?? 0,
      ...(opts.selectedExtras ? { selectedExtras: opts.selectedExtras as any } : {}),
      status: (opts.status ?? 'CONFIRMED') as any, paymentId: payment.id,
    },
  });
}

/** Turn the seed activity into a DAILY listing with 2 whole units at 400/night. */
async function makeDailyActivity(activityId: string, overrides: Record<string, unknown> = {}) {
  await ctx.prisma.activity.update({
    where: { id: activityId },
    data: {
      bookingType: 'DAILY', pricingModel: 'PER_UNIT', pricePerPerson: 400,
      durationValue: null, checkInTime: '14:00', checkOutTime: '11:00',
      capacity: 8, hasUnits: true, unitCount: 2, unitCapacity: 4, activeDays: [],
      ...overrides,
    },
  });
}

async function makeDailyBooking(seed: any, checkIn: string, checkOut: string, unitNumber: number | null, opts: { guests?: number; customerId?: string } = {}) {
  const nights = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000);
  const totalPrice = 400 * nights;
  const payment = await ctx.prisma.payment.create({
    data: { amount: totalPrice + 5, currency: 'QAR', status: 'SUCCESS', payoutStatus: 'UNPAID', method: 'CARD', paidAt: new Date(), gatewayTxnId: `TXN-${Math.random().toString(36).slice(2, 10)}` },
  });
  return ctx.prisma.booking.create({
    data: {
      ref: `JDWL-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      customerId: opts.customerId ?? seed.customer.id, vendorId: seed.vendor.id, activityId: seed.activity.id,
      guests: opts.guests ?? 2, bookingPhone: '+97455123456', guestBreakdown: {}, unitNumber,
      startDatetime: iso(checkIn, '14:00'), endDatetime: iso(checkOut, '11:00'),
      totalPrice, serviceFee: 5, currencyCode: 'QAR', commissionPct: 10, commissionAmount: totalPrice / 10,
      status: 'CONFIRMED', paymentId: payment.id,
    },
  });
}

async function makeOtherCustomer(email = 'other@test.com') {
  return ctx.prisma.user.create({
    data: { fullName: 'Other Customer', email, password: 'x', role: 'CUSTOMER', emailVerified: true },
  });
}

const slotAt = (hourly: any, time: string) => hourly.slots.find((s: any) => s.slotStart === time);
const reason = 'Customer asked by phone to move the trip';
const D = futureDate(10);
const D1 = addDays(D, 1);

describe('preview', () => {
  it('same price on the new date: new window, hours kept, difference 0, nothing written', async () => {
    const seed = await seedReference(ctx.prisma);
    const { service } = makeServices();
    const booking = await makeHourlyBooking(seed, D);

    const p = await service.preview(booking.id, { checkInDate: D1, slotTime: '14:00' });
    expect(p.to.startDatetime).toEqual(iso(D1, '14:00'));
    expect(p.to.endDatetime).toEqual(iso(D1, '16:00'));
    expect(p.hours).toBe(2);
    expect(p.nights).toBeNull();
    expect(p.priceBefore).toBe(200);
    expect(p.priceAfter).toBe(200);
    expect(p.difference).toBe(0);
    expect(p.settlementOptions).toEqual([]);
    expect(p.to.unitNumber).toBeNull();

    const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.startDatetime).toEqual(iso(D, '10:00'));
    expect(row.rescheduledAt).toBeNull();
    expect(await ctx.prisma.bookingReschedule.count()).toBe(0);
  });

  it('a special price on the new date raises the price: difference = (special − base) × guests, settle by paying or waiving', async () => {
    const seed = await seedReference(ctx.prisma);
    const { service } = makeServices();
    const booking = await makeHourlyBooking(seed, D);
    await ctx.prisma.activitySpecialPrice.create({ data: { activityId: seed.activity.id, vendorId: seed.vendor.id, date: new Date(`${D1}T00:00:00.000Z`), price: 150 } });

    const p = await service.preview(booking.id, { checkInDate: D1, slotTime: '14:00' });
    expect(p.priceAfter).toBe(300);
    expect(p.difference).toBe(100);
    expect(p.settlementOptions).toEqual(['PAID_OUTSIDE', 'WAIVED']);
  });

  it('priceBefore is what the customer was charged for the activity: nominal (total + coupon) minus add-ons, not a recompute', async () => {
    const seed = await seedReference(ctx.prisma);
    const { service } = makeServices();
    // Base was 200 (2 × 100); a 20 coupon and a 50 add-on were applied: totalPrice 230.
    const booking = await makeHourlyBooking(seed, D, { totalPrice: 230, couponDiscount: 20, selectedExtras: [{ name: 'Lunch', price: 25, qty: 2, perPerson: true }] });
    // The vendor has since raised the base price; the old booking's price must not follow.
    await ctx.prisma.activity.update({ where: { id: seed.activity.id }, data: { pricePerPerson: 120 } });

    const p = await service.preview(booking.id, { checkInDate: D1, slotTime: '14:00' });
    expect(p.priceBefore).toBe(200);
    expect(p.priceAfter).toBe(240);
    expect(p.difference).toBe(40);
  });

  it('a cheaper new date: negative difference, settle by refunding or waiving', async () => {
    const seed = await seedReference(ctx.prisma);
    const { service } = makeServices();
    const booking = await makeHourlyBooking(seed, D);
    await ctx.prisma.activitySpecialPrice.create({ data: { activityId: seed.activity.id, vendorId: seed.vendor.id, date: new Date(`${D1}T00:00:00.000Z`), price: 80 } });

    const p = await service.preview(booking.id, { checkInDate: D1, slotTime: '14:00' });
    expect(p.difference).toBe(-40);
    expect(p.settlementOptions).toEqual(['REFUNDED_OUTSIDE', 'WAIVED']);
  });
});

describe('reschedule', () => {
  it('moves the booking, records the change, frees the old slot, notifies customer and vendor, leaves the money untouched', async () => {
    const seed = await seedReference(ctx.prisma);
    const { service, bookings, availabilityCache } = makeServices();
    const booking = await makeHourlyBooking(seed, D);
    const paymentBefore = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: booking.paymentId! } });

    const result = await service.reschedule(booking.id, ADMIN, { checkInDate: D1, slotTime: '14:00', reason, expectedDifference: 0 });

    expect(result.booking.startDatetime).toEqual(iso(D1, '14:00'));
    expect(result.booking.endDatetime).toEqual(iso(D1, '16:00'));
    expect(result.booking.status).toBe('CONFIRMED');
    expect(result.booking.rescheduledAt).toBeInstanceOf(Date);

    const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { reschedules: true } });
    expect(Number(row.totalPrice)).toBe(200);
    expect(Number(row.commissionAmount)).toBe(20);
    expect(Number(row.serviceFee)).toBe(5);
    const paymentAfter = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: booking.paymentId! } });
    expect(paymentAfter.amount).toEqual(paymentBefore.amount);
    expect(paymentAfter.status).toBe('SUCCESS');

    expect(row.reschedules).toHaveLength(1);
    const change = row.reschedules[0];
    expect(change.fromStartDatetime).toEqual(iso(D, '10:00'));
    expect(change.fromEndDatetime).toEqual(iso(D, '12:00'));
    expect(change.toStartDatetime).toEqual(iso(D1, '14:00'));
    expect(change.toEndDatetime).toEqual(iso(D1, '16:00'));
    expect(Number(change.priceBefore)).toBe(200);
    expect(Number(change.priceAfter)).toBe(200);
    expect(Number(change.priceDifference)).toBe(0);
    expect(change.settlement).toBeNull();
    expect(change.reason).toBe(reason);
    expect(change.adminId).toBe(ADMIN.id);
    expect(change.adminName).toBe(ADMIN.name);
    expect(result.reschedule.id).toBe(change.id);

    // Audit: a FINANCIAL row with the dates and the money, written in the same transaction.
    const audits = await ctx.prisma.auditLog.findMany({ where: { entityId: booking.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'BOOKING_RESCHEDULED', actorType: 'ADMIN', actorId: ADMIN.id, actionCategory: 'FINANCIAL', entity: 'Booking' });
    expect(audits[0].details).toContain(booking.ref);
    expect(audits[0].details).toContain('no money moved');

    // Old slot free, new slot taken; cache invalidated for the activity.
    const oldDay = await bookings.getHourlyAvailability(seed.activity.id, D);
    expect(slotAt(oldDay, '10:00').available).toBe(10);
    const newDay = await bookings.getHourlyAvailability(seed.activity.id, D1);
    expect(slotAt(newDay, '14:00').available).toBe(8);
    expect(availabilityCache.invalidate).toHaveBeenCalledWith(seed.activity.id);

    // Customer + vendor in-app notifications.
    const notes = await ctx.prisma.notification.findMany({ orderBy: { createdAt: 'asc' } });
    const customerNote = notes.find((n) => n.userId === seed.customer.id)!;
    const vendorNote = notes.find((n) => n.userId === seed.vendorUser.id)!;
    expect(customerNote).toMatchObject({ type: 'BOOKING_RESCHEDULED', title: 'Your booking date was changed', link: `/bookings/${booking.id}` });
    expect(customerNote.message).toContain(booking.ref);
    expect(customerNote.message).toContain('14:00–16:00');
    expect(vendorNote).toMatchObject({ type: 'BOOKING_RESCHEDULED', title: 'Booking date changed', link: `/vendor/${seed.vendor.slug}/bookings` });
    expect(vendorNote.message).toContain('Test Customer');
    // Customer's message does not mention the vendor's money; vendor's does not get the reason.
    expect(vendorNote.message).not.toContain(reason);

    // Emails through the outbox: one to the customer, one to the vendor.
    const outbox = await ctx.prisma.emailOutbox.findMany({ orderBy: { createdAt: 'asc' } });
    expect(outbox.map((o) => o.emailType).sort()).toEqual(['BOOKING_RESCHEDULED', 'VENDOR_BOOKING_RESCHEDULED']);
    const customerMail = outbox.find((o) => o.emailType === 'BOOKING_RESCHEDULED')!;
    expect(customerMail.recipient).toBe('customer@test.com');
    expect(customerMail.bookingId).toBe(booking.id);
    expect(customerMail.payload).toMatchObject({ customerName: 'Test Customer', bookingRef: booking.ref, bookingId: booking.id, activityTitle: 'Sample Tour' });
    expect((customerMail.payload as any).toText).toContain('14:00–16:00');
    const vendorMail = outbox.find((o) => o.emailType === 'VENDOR_BOOKING_RESCHEDULED')!;
    expect(vendorMail.recipient).toBe('vendor@test.com');
    expect(vendorMail.payload).toMatchObject({ vendorName: 'Test Vendor', vendorSlug: 'test-biz', customerName: 'Test Customer', customerPhone: '+97455123456', guests: 2 });
  });

  it('a price difference must be settled, in the right direction, and the admin-confirmed difference must still hold', async () => {
    const seed = await seedReference(ctx.prisma);
    const { service } = makeServices();
    const booking = await makeHourlyBooking(seed, D);
    await ctx.prisma.activitySpecialPrice.create({ data: { activityId: seed.activity.id, vendorId: seed.vendor.id, date: new Date(`${D1}T00:00:00.000Z`), price: 150 } });
    const base = { checkInDate: D1, slotTime: '14:00', reason };

    // Stale: the admin confirmed 0 but the dates now cost 100 more.
    await expect(service.reschedule(booking.id, ADMIN, { ...base, expectedDifference: 0, settlement: 'WAIVED' })).rejects.toBeInstanceOf(ConflictException);
    // No settlement for a non-zero difference.
    await expect(service.reschedule(booking.id, ADMIN, { ...base, expectedDifference: 100 })).rejects.toBeInstanceOf(BadRequestException);
    // Wrong direction: the customer owes more, a refund does not apply.
    await expect(service.reschedule(booking.id, ADMIN, { ...base, expectedDifference: 100, settlement: 'REFUNDED_OUTSIDE' })).rejects.toBeInstanceOf(BadRequestException);
    expect(await ctx.prisma.bookingReschedule.count()).toBe(0);
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).startDatetime).toEqual(iso(D, '10:00'));

    const ok = await service.reschedule(booking.id, ADMIN, { ...base, expectedDifference: 100, settlement: 'PAID_OUTSIDE', settlementRef: 'Bank transfer 4471' });
    expect(Number(ok.reschedule.priceDifference)).toBe(100);
    expect(ok.reschedule.settlement).toBe('PAID_OUTSIDE');
    expect(ok.reschedule.settlementRef).toBe('Bank transfer 4471');
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({ where: { entityId: booking.id } });
    expect(audit.details).toContain('+100.00');
    expect(audit.details).toContain('PAID_OUTSIDE ref Bank transfer 4471');
    // The stored money is still the original booking's.
    const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(Number(row.totalPrice)).toBe(200);
  });

  it('a settlement is refused when the price does not change', async () => {
    const seed = await seedReference(ctx.prisma);
    const { service } = makeServices();
    const booking = await makeHourlyBooking(seed, D);
    await expect(
      service.reschedule(booking.id, ADMIN, { checkInDate: D1, slotTime: '14:00', reason, expectedDifference: 0, settlement: 'WAIVED' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a second change starts from the price after the first change', async () => {
    const seed = await seedReference(ctx.prisma);
    const { service } = makeServices();
    const booking = await makeHourlyBooking(seed, D);
    await ctx.prisma.activitySpecialPrice.create({ data: { activityId: seed.activity.id, vendorId: seed.vendor.id, date: new Date(`${D1}T00:00:00.000Z`), price: 150 } });
    await service.reschedule(booking.id, ADMIN, { checkInDate: D1, slotTime: '14:00', reason, expectedDifference: 100, settlement: 'PAID_OUTSIDE' });

    // Back to a normal-priced day: 300 → 200, the customer is owed 100.
    const D2 = addDays(D, 2);
    const p = await service.preview(booking.id, { checkInDate: D2, slotTime: '09:00' });
    expect(p.priceBefore).toBe(300);
    expect(p.difference).toBe(-100);
    await expect(service.reschedule(booking.id, ADMIN, { checkInDate: D2, slotTime: '09:00', reason, expectedDifference: -100, settlement: 'PAID_OUTSIDE' })).rejects.toBeInstanceOf(BadRequestException);
    const second = await service.reschedule(booking.id, ADMIN, { checkInDate: D2, slotTime: '09:00', reason, expectedDifference: -100, settlement: 'REFUNDED_OUTSIDE' });
    expect(Number(second.reschedule.priceBefore)).toBe(300);
    expect(Number(second.reschedule.priceDifference)).toBe(-100);
    expect(await ctx.prisma.bookingReschedule.count({ where: { bookingId: booking.id } })).toBe(2);
    const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.startDatetime).toEqual(iso(D2, '09:00'));
  });

  it('an Arabic customer is notified in Arabic; the email carries both languages', async () => {
    const seed = await seedReference(ctx.prisma);
    const { service } = makeServices();
    await ctx.prisma.user.update({ where: { id: seed.customer.id }, data: { preferredLanguage: 'AR' } });
    const booking = await makeHourlyBooking(seed, D);
    await service.reschedule(booking.id, ADMIN, { checkInDate: D1, slotTime: '14:00', reason, expectedDifference: 0 });
    const note = await ctx.prisma.notification.findFirstOrThrow({ where: { userId: seed.customer.id } });
    expect(note.title).toBe('تم تغيير تاريخ حجزك');
    expect(note.message).toContain('جولة');
    const mail = await ctx.prisma.emailOutbox.findFirstOrThrow({ where: { emailType: 'BOOKING_RESCHEDULED' } });
    expect((mail.payload as any).toTextAr).toContain('14:00');
    expect((mail.payload as any).activityTitleAr).toBe('جولة');
  });

  it('no email row for a deleted customer address, the vendor is still notified', async () => {
    const seed = await seedReference(ctx.prisma);
    const { service } = makeServices();
    await ctx.prisma.user.update({ where: { id: seed.customer.id }, data: { email: `deleted-${seed.customer.id}@deleted.local` } });
    const booking = await makeHourlyBooking(seed, D);
    await service.reschedule(booking.id, ADMIN, { checkInDate: D1, slotTime: '14:00', reason, expectedDifference: 0 });
    const outbox = await ctx.prisma.emailOutbox.findMany();
    expect(outbox.map((o) => o.emailType)).toEqual(['VENDOR_BOOKING_RESCHEDULED']);
  });
});

describe('refusals', () => {
  const move = (service: BookingRescheduleService, id: string, checkInDate: string, slotTime = '14:00') =>
    service.reschedule(id, ADMIN, { checkInDate, slotTime, reason, expectedDifference: 0 });

  it('only a confirmed booking: pending, cancelled and completed are refused', async () => {
    const seed = await seedReference(ctx.prisma);
    const { service } = makeServices();
    for (const status of ['PENDING', 'CANCELLED', 'COMPLETED']) {
      const b = await makeHourlyBooking(seed, D, { status });
      await expect(move(service, b.id, D1)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.preview(b.id, { checkInDate: D1, slotTime: '14:00' })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(await ctx.prisma.bookingReschedule.count()).toBe(0);
  });

  it('a booking that has started cannot be moved', async () => {
    const seed = await seedReference(ctx.prisma);
    const { service } = makeServices();
    const b = await makeHourlyBooking(seed, D);
    await ctx.prisma.booking.update({ where: { id: b.id }, data: { startDatetime: new Date(Date.now() - 3_600_000), endDatetime: new Date(Date.now() + 3_600_000) } });
    await expect(move(service, b.id, D1)).rejects.toThrow(/already started/);
  });

  it('a refunded or refund-pending payment blocks the move', async () => {
    const seed = await seedReference(ctx.prisma);
    const { service } = makeServices();
    const b = await makeHourlyBooking(seed, D);
    await ctx.prisma.payment.update({ where: { id: b.paymentId! }, data: { status: 'REFUND_PENDING' } });
    await expect(move(service, b.id, D1)).rejects.toThrow(/being refunded/);
  });

  it('date rules: past date, same dates, beyond the advance limit, inactive weekday', async () => {
    const seed = await seedReference(ctx.prisma);
    const { service } = makeServices();
    const b = await makeHourlyBooking(seed, D);
    await expect(move(service, b.id, futureDate(-1))).rejects.toThrow(/past date/);
    await expect(move(service, b.id, D, '10:00')).rejects.toThrow(/already on these dates/);
    await expect(move(service, b.id, futureDate(7 * 31))).rejects.toThrow(/more than 6 month/);
    // Only Mondays: pick the first non-Monday within the next week.
    await ctx.prisma.activity.update({ where: { id: seed.activity.id }, data: { activeDays: ['MON'] } });
    let notMonday = D1;
    while (new Date(`${notMonday}T00:00:00Z`).getUTCDay() === 1) notMonday = addDays(notMonday, 1);
    await expect(move(service, b.id, notMonday)).rejects.toThrow(/not available on/);
  });

  it('hourly rules: start time required, on the hour or half-hour, inside opening hours for the booked length', async () => {
    const seed = await seedReference(ctx.prisma);
    const { service } = makeServices();
    const b = await makeHourlyBooking(seed, D); // 2h; activity open 09:00–21:00
    await expect(service.reschedule(b.id, ADMIN, { checkInDate: D1, reason, expectedDifference: 0 })).rejects.toThrow(/start time/);
    await expect(move(service, b.id, D1, '10:15')).rejects.toThrow(/hour or half-hour/);
    await expect(move(service, b.id, D1, '08:00')).rejects.toThrow(/before the activity opens/);
    await expect(move(service, b.id, D1, '20:00')).rejects.toThrow(/after the activity closes/);
    // 19:00 → 21:00 is the last valid start.
    await expect(move(service, b.id, D1, '19:00')).resolves.toBeDefined();
  });

  it('a vendor block on the new dates refuses the move', async () => {
    const seed = await seedReference(ctx.prisma);
    const { service } = makeServices();
    const b = await makeHourlyBooking(seed, D);
    await ctx.prisma.activityBlock.create({ data: { activityId: seed.activity.id, vendorId: seed.vendor.id, blockStart: iso(D1, '15:00'), blockEnd: iso(D1, '18:00') } });
    await expect(move(service, b.id, D1, '14:00')).rejects.toThrow(/closed these dates/); // 14–16 crosses the 15:00 lock
    await expect(move(service, b.id, D1, '12:00')).resolves.toBeDefined(); // 12–14 ends before it
  });

  it('no capacity on the new slot: preview says how many seats are left, the move is refused', async () => {
    const seed = await seedReference(ctx.prisma);
    const { service } = makeServices();
    const other = await makeOtherCustomer();
    const b = await makeHourlyBooking(seed, D);
    await makeHourlyBooking(seed, D1, { guests: 9, start: '14:00', customerId: other.id }); // 1 seat left of 10
    await expect(service.preview(b.id, { checkInDate: D1, slotTime: '14:00' })).rejects.toThrow(/Only 1 seat available/);
    await expect(move(service, b.id, D1, '14:00')).rejects.toBeInstanceOf(ConflictException);
    // The same booking can still move to a free slot the same day.
    await expect(move(service, b.id, D1, '17:00')).resolves.toBeDefined();
  });

  it('moving by one hour works: the booking does not block itself', async () => {
    const seed = await seedReference(ctx.prisma);
    const { service } = makeServices();
    const other = await makeOtherCustomer();
    const b = await makeHourlyBooking(seed, D); // 10–12
    await makeHourlyBooking(seed, D, { guests: 8, start: '11:00', customerId: other.id }); // 11–13: with ours, 10 at 11–12
    const res = await move(service, b.id, D, '09:00'); // 09–11, overlaps our old window only
    expect(res.booking.startDatetime).toEqual(iso(D, '09:00'));
  });
});

describe('daily listings with units', () => {
  const N = futureDate(20);
  it('keeps the nights and the unit, prices each night with special prices', async () => {
    const seed = await seedReference(ctx.prisma);
    await makeDailyActivity(seed.activity.id);
    const { service, bookings } = makeServices();
    const b = await makeDailyBooking(seed, N, addDays(N, 2), 1); // 2 nights, unit 1, 800
    const T = addDays(N, 5);
    await ctx.prisma.activitySpecialPrice.create({ data: { activityId: seed.activity.id, vendorId: seed.vendor.id, date: new Date(`${addDays(T, 1)}T00:00:00.000Z`), price: 500 } });

    const p = await service.preview(b.id, { checkInDate: T });
    expect(p.nights).toBe(2);
    expect(p.to.checkOutDate).toBe(addDays(T, 2));
    expect(p.to.startDatetime).toEqual(iso(T, '14:00'));
    expect(p.to.endDatetime).toEqual(iso(addDays(T, 2), '11:00'));
    expect(p.priceBefore).toBe(800);
    expect(p.priceAfter).toBe(900);
    expect(p.difference).toBe(100);
    expect(p.to.unitNumber).toBe(1);

    const res = await service.reschedule(b.id, ADMIN, { checkInDate: T, reason, expectedDifference: 100, settlement: 'WAIVED' });
    expect(res.booking.unitNumber).toBe(1);
    expect(res.reschedule.fromUnitNumber).toBe(1);
    expect(res.reschedule.toUnitNumber).toBe(1);
    expect(res.reschedule.settlement).toBe('WAIVED');

    // Old nights free again, new nights taken (calendar view).
    const cal: any = await bookings.getCalendarAvailability(seed.activity.id, N.slice(0, 7));
    const oldNight = cal.days.find((d: any) => d.date === N);
    expect(oldNight.booked).toBe(0);
    const calT: any = await bookings.getCalendarAvailability(seed.activity.id, T.slice(0, 7));
    expect(calT.days.find((d: any) => d.date === T).booked).toBe(1);
  });

  it('takes another unit when its own is occupied on the new nights; refuses when none is free', async () => {
    const seed = await seedReference(ctx.prisma);
    await makeDailyActivity(seed.activity.id);
    const { service } = makeServices();
    const other = await makeOtherCustomer();
    const b = await makeDailyBooking(seed, N, addDays(N, 2), 1);
    const T = addDays(N, 5);
    await makeDailyBooking(seed, T, addDays(T, 1), 1, { customerId: other.id }); // unit 1 busy on the first new night

    const p = await service.preview(b.id, { checkInDate: T });
    expect(p.to.unitNumber).toBe(2);

    const other2 = await makeOtherCustomer('other2@test.com');
    await makeDailyBooking(seed, addDays(T, 1), addDays(T, 2), 2, { customerId: other2.id }); // unit 2 busy on the second night
    await expect(service.preview(b.id, { checkInDate: T })).rejects.toThrow(/All units are booked/);
    await expect(service.reschedule(b.id, ADMIN, { checkInDate: T, reason, expectedDifference: 0 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks are judged by nights: a closed check-out day is fine, a closed night is not', async () => {
    const seed = await seedReference(ctx.prisma);
    await makeDailyActivity(seed.activity.id);
    const { service } = makeServices();
    const b = await makeDailyBooking(seed, N, addDays(N, 2), 1);
    const T = addDays(N, 5);
    // Whole-day block on the check-out day: the guest leaves at 11:00, nobody sleeps that night.
    await ctx.prisma.activityBlock.create({ data: { activityId: seed.activity.id, vendorId: seed.vendor.id, blockStart: iso(addDays(T, 2), '00:00'), blockEnd: iso(addDays(T, 3), '00:00') } });
    await expect(service.preview(b.id, { checkInDate: T })).resolves.toBeDefined();
    // Whole-day block on the second night.
    await ctx.prisma.activityBlock.create({ data: { activityId: seed.activity.id, vendorId: seed.vendor.id, blockStart: iso(addDays(T, 1), '00:00'), blockEnd: iso(addDays(T, 2), '00:00') } });
    await expect(service.preview(b.id, { checkInDate: T })).rejects.toThrow(/closed these dates/);
  });

  it('a stay can move by one night: it does not block itself', async () => {
    const seed = await seedReference(ctx.prisma);
    await makeDailyActivity(seed.activity.id, { unitCount: 1, capacity: 4 });
    const { service } = makeServices();
    const b = await makeDailyBooking(seed, N, addDays(N, 2), 1);
    const res = await service.reschedule(b.id, ADMIN, { checkInDate: addDays(N, 1), reason, expectedDifference: 0 });
    expect(res.booking.startDatetime).toEqual(iso(addDays(N, 1), '14:00'));
    expect(res.booking.endDatetime).toEqual(iso(addDays(N, 3), '11:00'));
    expect(res.booking.unitNumber).toBe(1);
  });

  it('per-person daily pricing multiplies each night by the charged guests', async () => {
    const seed = await seedReference(ctx.prisma);
    await makeDailyActivity(seed.activity.id, { pricingModel: 'PER_PERSON', pricePerPerson: 250, minGuests: 2, hasUnits: false, unitCount: 0, capacity: 40 });
    const { service } = makeServices();
    // 2 nights × 250 × 2 guests = 1000 charged.
    const payment = await ctx.prisma.payment.create({ data: { amount: 1005, currency: 'QAR', status: 'SUCCESS', payoutStatus: 'UNPAID', method: 'CARD', paidAt: new Date(), gatewayTxnId: 'TXN-PP' } });
    const b = await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-PPDAY', customerId: seed.customer.id, vendorId: seed.vendor.id, activityId: seed.activity.id,
        guests: 2, bookingPhone: '+97455123456', guestBreakdown: {},
        startDatetime: iso(N, '14:00'), endDatetime: iso(addDays(N, 2), '11:00'),
        totalPrice: 1000, serviceFee: 5, currencyCode: 'QAR', commissionPct: 10, commissionAmount: 100,
        status: 'CONFIRMED', paymentId: payment.id,
      },
    });
    const T = addDays(N, 5);
    await ctx.prisma.activitySpecialPrice.create({ data: { activityId: seed.activity.id, vendorId: seed.vendor.id, date: new Date(`${T}T00:00:00.000Z`), price: 300 } });
    const p = await service.preview(b.id, { checkInDate: T });
    expect(p.priceBefore).toBe(1000);
    expect(p.priceAfter).toBe((300 + 250) * 2);
    expect(p.difference).toBe(100);
  });
});

describe('concurrency', () => {
  it('two moves of the same booking at once: exactly one wins, the other gets 409', async () => {
    const seed = await seedReference(ctx.prisma);
    const { service } = makeServices();
    const b = await makeHourlyBooking(seed, D);
    const results = await Promise.allSettled([
      service.reschedule(b.id, ADMIN, { checkInDate: D1, slotTime: '14:00', reason, expectedDifference: 0 }),
      service.reschedule(b.id, ADMIN, { checkInDate: D1, slotTime: '17:00', reason, expectedDifference: 0 }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBeInstanceOf(ConflictException);
    expect(await ctx.prisma.bookingReschedule.count()).toBe(1);
    const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect([iso(D1, '14:00').getTime(), iso(D1, '17:00').getTime()]).toContain(row.startDatetime.getTime());
  });

  it('two bookings racing for the last unit: exactly one gets it', async () => {
    const seed = await seedReference(ctx.prisma);
    await makeDailyActivity(seed.activity.id, { unitCount: 1, capacity: 4 });
    const { service } = makeServices();
    const other = await makeOtherCustomer();
    const N = futureDate(20);
    const a = await makeDailyBooking(seed, N, addDays(N, 1), 1);
    const c = await makeDailyBooking(seed, addDays(N, 2), addDays(N, 3), 1, { customerId: other.id });
    const T = addDays(N, 6);
    const results = await Promise.allSettled([
      service.reschedule(a.id, ADMIN, { checkInDate: T, reason, expectedDifference: 0 }),
      service.reschedule(c.id, ADMIN, { checkInDate: T, reason, expectedDifference: 0 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    const onT = await ctx.prisma.booking.count({ where: { activityId: seed.activity.id, startDatetime: iso(T, '14:00') } });
    expect(onT).toBe(1);
  });
});
