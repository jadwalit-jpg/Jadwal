/**
 * Integration — paid add-ons through the real createBooking path (real
 * Postgres), on the overnight camp as the owner runs it: DAILY, QAR 250 per
 * person, minimum 2 guests, no units, capacity 40, with three add-ons:
 *   VIP cabin     per person, whole group  (QAR 100)
 *   Lunch box     per person               (QAR 50)
 *   Photographer  per booking              (QAR 200)
 *
 * Pins: a whole-group add-on is charged for the REAL guest count and a
 * quantity sent by the browser is ignored; a solo guest on a minimum-2
 * listing pays the minimum base price plus ONE add-on; existing per-person
 * and per-booking add-ons price exactly as before; the frozen selectedExtras
 * carry quantity, Arabic name and the whole-group flag; add-ons are charged
 * once per booking, not per night.
 */
import { getTestContext, seedReference } from './_setup';
import { BookingsService } from '../../src/bookings/bookings.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { BadRequestException } from '@nestjs/common';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

const SERVICE_FEE = 5; // seedReference country.serviceFeeFixed

const EXTRAS = [
  { name: 'VIP cabin', nameAr: 'كابينة VIP', price: 100, perPerson: true, wholeGroup: true },
  { name: 'Lunch box', nameAr: 'وجبة غداء', price: 50, perPerson: true },
  { name: 'Photographer', nameAr: 'مصور', price: 200 },
];

function makeBookings() {
  const prismaSvc = { client: ctx.prisma } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  const notificationService = { send: jest.fn().mockResolvedValue(undefined), notifyAdmins: jest.fn().mockResolvedValue(undefined), sendToMany: jest.fn().mockResolvedValue(undefined) } as any;
  const availabilityCache = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any;
  const redisLock = { acquire: jest.fn().mockResolvedValue('lock-token'), release: jest.fn().mockResolvedValue(undefined) } as any;
  const configService = {
    get: (k: string, fb?: string) => (({ RESERVATION_WINDOW_MINUTES: '15', BOOKING_MAX_ADVANCE_MONTHS: '6', REDIS_LOCK_TTL_MS: '30000' }) as Record<string, string>)[k] ?? fb,
  } as any;
  return new BookingsService(
    prismaSvc, { log: jest.fn().mockResolvedValue(undefined) } as any, notificationService, redisLock,
    configService, loyalty, availabilityCache,
    { sendBookingOtp: jest.fn().mockResolvedValue(undefined) } as any,
    { tryConsume: jest.fn().mockResolvedValue(true) } as any,
    { log: jest.fn() } as any,
  );
}

/** The camp: DAILY per person, QAR 250, minimum 2, capacity 40, units off, with the three add-ons. */
async function makeCamp(activityId: string, extraServices: unknown = EXTRAS) {
  await ctx.prisma.activity.update({
    where: { id: activityId },
    data: {
      bookingType: 'DAILY', pricingModel: 'PER_PERSON', pricePerPerson: 250, minGuests: 2,
      durationValue: null, checkInTime: '14:00', checkOutTime: '09:00',
      capacity: 40, hasUnits: false, unitCount: 0, unitCapacity: 1, activeDays: [],
      extraServices: extraServices as any,
    },
  });
}

function futureDate(days: number): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}

async function book(bookings: BookingsService, customerId: string, activityId: string, guests: number, extra: Record<string, unknown> = {}, nights = 1) {
  const checkIn = futureDate(10 + nights * 3 + guests); // distinct nights per case so bookings never collide
  const d = new Date(`${checkIn}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + nights);
  const res: any = await bookings.createBooking(customerId, {
    activityId, checkInDate: checkIn, checkOutDate: d.toISOString().slice(0, 10), guests, bookingPhone: '+97455123456', ...extra,
  } as any);
  const booking = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: res.booking.id } });
  const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { bookingId: res.booking.id } });
  return { booking, payment, extras: (booking.selectedExtras ?? []) as Array<Record<string, unknown>> };
}

describe('whole-group add-on (VIP cabin, QAR 100 per person for every guest)', () => {
  test('3 guests, 1 night: 750 + 300 = 1,050; the frozen add-on carries qty 3, the Arabic name and the flag', async () => {
    const seed = await seedReference(ctx.prisma);
    await makeCamp(seed.activity.id);
    const { booking, payment, extras } = await book(makeBookings(), seed.customer.id, seed.activity.id, 3, { selectedExtras: ['VIP cabin'] });
    expect(Number(booking.totalPrice)).toBe(1050);
    expect(Number(payment.amount)).toBe(1050 + SERVICE_FEE);
    expect(extras).toEqual([{ name: 'VIP cabin', nameAr: 'كابينة VIP', price: 100, qty: 3, perPerson: true, wholeGroup: true }]);
  });

  test('6 guests: 1,500 + 600 = 2,100', async () => {
    const seed = await seedReference(ctx.prisma);
    await makeCamp(seed.activity.id);
    const { booking } = await book(makeBookings(), seed.customer.id, seed.activity.id, 6, { selectedExtras: ['VIP cabin'] });
    expect(Number(booking.totalPrice)).toBe(2100);
  });

  test('a quantity sent by the browser is ignored: 3 guests with qty 1 (or 99) is still charged for 3', async () => {
    const seed = await seedReference(ctx.prisma);
    await makeCamp(seed.activity.id);
    const bookings = makeBookings();
    const low = await book(bookings, seed.customer.id, seed.activity.id, 3, { selectedExtras: ['VIP cabin'], selectedExtrasQty: { 'VIP cabin': 1 } });
    expect(Number(low.booking.totalPrice)).toBe(1050);
    expect(low.extras[0]).toMatchObject({ qty: 3 });
    const other = await ctx.prisma.user.create({ data: { fullName: 'Other', email: 'other@test.com', password: 'x', role: 'CUSTOMER', emailVerified: true } });
    const high = await book(bookings, other.id, seed.activity.id, 3, { selectedExtras: ['VIP cabin'], selectedExtrasQty: { 'VIP cabin': 99 } }, 2);
    expect(Number(high.booking.totalPrice)).toBe(2 * 750 + 300); // two nights of base, the add-on once
    expect(high.extras[0]).toMatchObject({ qty: 3 });
  });

  test('a solo guest on the minimum-2 listing pays the minimum base price plus ONE add-on: 500 + 100 = 600, payment 605', async () => {
    const seed = await seedReference(ctx.prisma);
    await makeCamp(seed.activity.id);
    const { booking, payment, extras } = await book(makeBookings(), seed.customer.id, seed.activity.id, 1, { selectedExtras: ['VIP cabin'] });
    expect(booking.guests).toBe(1);
    expect(Number(booking.totalPrice)).toBe(600);
    expect(Number(payment.amount)).toBe(605);
    expect(extras[0]).toMatchObject({ qty: 1, wholeGroup: true });
  });

  test('charged once per booking, not per night: 2 guests, 3 nights = 1,500 base + 200', async () => {
    const seed = await seedReference(ctx.prisma);
    await makeCamp(seed.activity.id);
    const { booking } = await book(makeBookings(), seed.customer.id, seed.activity.id, 2, { selectedExtras: ['VIP cabin'] }, 3);
    expect(Number(booking.totalPrice)).toBe(3 * 500 + 200);
  });
});

describe('existing add-on kinds price exactly as before', () => {
  test('per person (Lunch box): the chosen quantity, clamped to the guests, defaulting to the guests', async () => {
    const seed = await seedReference(ctx.prisma);
    await makeCamp(seed.activity.id);
    const bookings = makeBookings();
    const two = await book(bookings, seed.customer.id, seed.activity.id, 3, { selectedExtras: ['Lunch box'], selectedExtrasQty: { 'Lunch box': 2 } });
    expect(Number(two.booking.totalPrice)).toBe(750 + 100);
    expect(two.extras).toEqual([{ name: 'Lunch box', nameAr: 'وجبة غداء', price: 50, qty: 2, perPerson: true }]);
    const c2 = await ctx.prisma.user.create({ data: { fullName: 'C2', email: 'c2@test.com', password: 'x', role: 'CUSTOMER', emailVerified: true } });
    const clamped = await book(bookings, c2.id, seed.activity.id, 3, { selectedExtras: ['Lunch box'], selectedExtrasQty: { 'Lunch box': 9 } }, 2);
    expect(Number(clamped.booking.totalPrice)).toBe(2 * 750 + 150);
    const c3 = await ctx.prisma.user.create({ data: { fullName: 'C3', email: 'c3@test.com', password: 'x', role: 'CUSTOMER', emailVerified: true } });
    const dflt = await book(bookings, c3.id, seed.activity.id, 3, { selectedExtras: ['Lunch box'] }, 3);
    expect(Number(dflt.booking.totalPrice)).toBe(3 * 750 + 150);
  });

  test('per booking (Photographer): always ×1, whatever quantity is sent', async () => {
    const seed = await seedReference(ctx.prisma);
    await makeCamp(seed.activity.id);
    const { booking, extras } = await book(makeBookings(), seed.customer.id, seed.activity.id, 3, { selectedExtras: ['Photographer'], selectedExtrasQty: { Photographer: 5 } });
    expect(Number(booking.totalPrice)).toBe(750 + 200);
    expect(extras).toEqual([{ name: 'Photographer', nameAr: 'مصور', price: 200, qty: 1, perPerson: false }]);
  });

  test('all three together, 2 guests: 500 + 200 (VIP × 2) + 100 (lunch × 2) + 200 = 1,000', async () => {
    const seed = await seedReference(ctx.prisma);
    await makeCamp(seed.activity.id);
    const { booking, extras } = await book(makeBookings(), seed.customer.id, seed.activity.id, 2, { selectedExtras: ['VIP cabin', 'Lunch box', 'Photographer'] });
    expect(Number(booking.totalPrice)).toBe(1000);
    expect(extras.map((e) => [e.name, e.qty])).toEqual([['VIP cabin', 2], ['Lunch box', 2], ['Photographer', 1]]);
  });

  test('an add-on without the flag on another listing is unchanged (HOURLY seed listing, per-person × guests)', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.activity.update({ where: { id: seed.activity.id }, data: { extraServices: [{ name: 'Snack', price: 50, perPerson: true }] as any } });
    const date = futureDate(40);
    const res: any = await makeBookings().createBooking(seed.customer.id, {
      activityId: seed.activity.id, checkInDate: date, slotTime: '10:00', guests: 2, bookingPhone: '+97455123456', selectedExtras: ['Snack'],
    } as any);
    const booking = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: res.booking.id } });
    expect(Number(booking.totalPrice)).toBe(2 * 100 + 2 * 50);
    expect(booking.selectedExtras).toEqual([{ name: 'Snack', price: 50, qty: 2, perPerson: true }]);
  });

  test('a whole-group flag on a per-booking add-on is ignored (flat × 1)', async () => {
    const seed = await seedReference(ctx.prisma);
    await makeCamp(seed.activity.id, [{ name: 'Decor', price: 300, perPerson: false, wholeGroup: true }]);
    const { booking, extras } = await book(makeBookings(), seed.customer.id, seed.activity.id, 4, { selectedExtras: ['Decor'] });
    expect(Number(booking.totalPrice)).toBe(1000 + 300);
    expect(extras).toEqual([{ name: 'Decor', price: 300, qty: 1, perPerson: false }]);
  });

  test('an add-on the listing does not offer is refused', async () => {
    const seed = await seedReference(ctx.prisma);
    await makeCamp(seed.activity.id);
    await expect(book(makeBookings(), seed.customer.id, seed.activity.id, 2, { selectedExtras: ['Helicopter'] })).rejects.toThrow(BadRequestException);
  });
});
