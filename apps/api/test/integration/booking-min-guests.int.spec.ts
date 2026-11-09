/**
 * Integration — minimum guests and per-person DAILY pricing, through the real
 * createBooking path (Serializable transaction, Postgres).
 *
 * Proves the three numbers always agree: the booking's totalPrice, the
 * payment amount (totalPrice + service fee), and the shared pricing helper.
 * The booking keeps the REAL guest count; only the charge uses the minimum.
 * Also proves existing DAILY PER_UNIT and HOURLY listings price exactly as
 * before (the default minimum is 1).
 */

import { getTestContext, seedReference } from './_setup';
import { VendorService } from '../../src/vendor/vendor.service';
import { AdminService } from '../../src/admin/admin.service';
import { BookingsService } from '../../src/bookings/bookings.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { makeSessionDenylistMock } from '../mocks/auth-deps.mock';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

const SERVICE_FEE = 5; // seedReference country.serviceFeeFixed

function makeServices() {
  const prismaSvc = { client: ctx.prisma } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  const notificationService = {
    send: jest.fn().mockResolvedValue(undefined),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
    sendToMany: jest.fn().mockResolvedValue(undefined),
  } as any;
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
  const auditLogger = { log: jest.fn().mockResolvedValue(undefined) } as any;

  const vendor = new VendorService(prismaSvc, notificationService, loyalty, availabilityCache, makeSessionDenylistMock() as any);
  const bookings = new BookingsService(
    prismaSvc, auditLogger, notificationService, redisLock,
    configService, loyalty, availabilityCache,
    { sendBookingOtp: jest.fn().mockResolvedValue(undefined) } as any,
    { tryConsume: jest.fn().mockResolvedValue(true) } as any,
    { log: jest.fn() } as any,
  );
  return { vendor, bookings };
}

function makeAdminService() {
  const prismaSvc = { client: ctx.prisma } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  const noop = {
    send: jest.fn().mockResolvedValue(undefined),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
    sendToMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const cache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  return new AdminService(
    prismaSvc, noop, loyalty, cache,
    { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any,
    makeSessionDenylistMock() as any,
  );
}

function futureDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The overnight camp: DAILY, QAR 250 per person, minimum 2 guests. */
async function makeCamp(activityId: string, overrides: Record<string, unknown> = {}) {
  await ctx.prisma.activity.update({
    where: { id: activityId },
    data: {
      bookingType: 'DAILY', pricingModel: 'PER_PERSON', pricePerPerson: 250, minGuests: 2,
      durationValue: null, checkInTime: '14:00', checkOutTime: '09:00',
      capacity: 60, hasUnits: false, activeDays: [],
      ...overrides,
    },
  });
}

async function bookDaily(bookings: any, customerId: string, activityId: string, checkIn: string, checkOut: string, guests: number) {
  const res: any = await bookings.createBooking(customerId, {
    activityId, checkInDate: checkIn, checkOutDate: checkOut, guests, bookingPhone: '+97455123456',
  } as any);
  return loadBookingAndPayment(res.booking.id);
}

async function loadBookingAndPayment(bookingId: string) {
  const booking = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { bookingId } });
  return { booking, payment };
}

describe('DAILY per person with a minimum of 2 guests (overnight camp)', () => {
  test('1 guest is charged as 2: total 500, payment 500 + fee, booking keeps 1 guest', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();
    await makeCamp(seed.activity.id);
    const { booking, payment } = await bookDaily(bookings, seed.customer.id, seed.activity.id, futureDate(10), futureDate(11), 1);
    expect(booking.guests).toBe(1);
    expect(Number(booking.totalPrice)).toBe(500);
    expect(Number(payment.amount)).toBe(500 + SERVICE_FEE);
  });

  test('2 guests: total 500', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();
    await makeCamp(seed.activity.id);
    const { booking, payment } = await bookDaily(bookings, seed.customer.id, seed.activity.id, futureDate(10), futureDate(11), 2);
    expect(booking.guests).toBe(2);
    expect(Number(booking.totalPrice)).toBe(500);
    expect(Number(payment.amount)).toBe(500 + SERVICE_FEE);
  });

  test('3 guests: total 750 (above the minimum, every guest is charged)', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();
    await makeCamp(seed.activity.id);
    const { booking, payment } = await bookDaily(bookings, seed.customer.id, seed.activity.id, futureDate(10), futureDate(11), 3);
    expect(booking.guests).toBe(3);
    expect(Number(booking.totalPrice)).toBe(750);
    expect(Number(payment.amount)).toBe(750 + SERVICE_FEE);
  });

  test('2 nights with a special-date price, 1 guest: (250 + 300) × 2 = 1100', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor, bookings } = makeServices();
    await makeCamp(seed.activity.id);
    const night2 = futureDate(21);
    await vendor.createActivitySpecialPrice(seed.vendorUser.id, seed.activity.id, { date: night2, price: 300 });
    const { booking, payment } = await bookDaily(bookings, seed.customer.id, seed.activity.id, futureDate(20), futureDate(22), 1);
    expect(booking.guests).toBe(1);
    expect(Number(booking.totalPrice)).toBe(1100);
    expect(Number(payment.amount)).toBe(1100 + SERVICE_FEE);
  });

  test('per-person extras charge the real guest count, not the minimum', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();
    await makeCamp(seed.activity.id, { extraServices: [{ name: 'Quad bike', price: 40, perPerson: true }] });
    const res: any = await bookings.createBooking(seed.customer.id, {
      activityId: seed.activity.id, checkInDate: futureDate(10), checkOutDate: futureDate(11),
      guests: 1, bookingPhone: '+97455123456', selectedExtras: ['Quad bike'],
    } as any);
    const { booking } = await loadBookingAndPayment(res.booking.id);
    expect(Number(booking.totalPrice)).toBe(500 + 40); // 2 × 250 (minimum) + 1 × 40 (real guest)
  });
});

describe('existing listings price exactly as before', () => {
  test('DAILY PER_UNIT (resort): price × nights, guests ignored', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();
    await makeCamp(seed.activity.id, { pricingModel: 'PER_UNIT', pricePerPerson: 1200, minGuests: 1, capacity: 10 });
    const { booking, payment } = await bookDaily(bookings, seed.customer.id, seed.activity.id, futureDate(10), futureDate(12), 4);
    expect(booking.guests).toBe(4);
    expect(Number(booking.totalPrice)).toBe(2400);
    expect(Number(payment.amount)).toBe(2400 + SERVICE_FEE);
  });

  test('DAILY PER_UNIT ignores a stored minimum', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();
    await makeCamp(seed.activity.id, { pricingModel: 'PER_UNIT', pricePerPerson: 1200, minGuests: 4, capacity: 10 });
    const { booking } = await bookDaily(bookings, seed.customer.id, seed.activity.id, futureDate(10), futureDate(11), 1);
    expect(Number(booking.totalPrice)).toBe(1200);
  });

  test('HOURLY PER_PERSON with the default minimum: price × guests (unchanged)', async () => {
    const seed = await seedReference(ctx.prisma); // HOURLY, PER_PERSON, 100 for 2 hours, minGuests default 1
    const { bookings } = makeServices();
    const res: any = await bookings.createBooking(seed.customer.id, {
      activityId: seed.activity.id, checkInDate: futureDate(7), slotTime: '10:00', guests: 3, bookingPhone: '+97455123456',
    } as any);
    const { booking, payment } = await loadBookingAndPayment(res.booking.id);
    expect(booking.guests).toBe(3);
    expect(Number(booking.totalPrice)).toBe(300);
    expect(Number(payment.amount)).toBe(300 + SERVICE_FEE);
  });

  test('HOURLY PER_PERSON with a minimum of 4: 2 guests charged as 4', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();
    await ctx.prisma.activity.update({ where: { id: seed.activity.id }, data: { minGuests: 4 } });
    const res: any = await bookings.createBooking(seed.customer.id, {
      activityId: seed.activity.id, checkInDate: futureDate(7), slotTime: '10:00', guests: 2, bookingPhone: '+97455123456',
    } as any);
    const { booking, payment } = await loadBookingAndPayment(res.booking.id);
    expect(booking.guests).toBe(2);
    expect(Number(booking.totalPrice)).toBe(400);
    expect(Number(payment.amount)).toBe(400 + SERVICE_FEE);
  });

  test('a new activity defaults to minGuests = 1', async () => {
    const seed = await seedReference(ctx.prisma);
    const a = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: seed.activity.id } });
    expect(a.minGuests).toBe(1);
  });
});

describe('saving minimum guests', () => {
  test('vendor update rejects a minimum above what one booking can hold', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    await makeCamp(seed.activity.id, { capacity: 3, minGuests: 1 });
    await expect(vendor.updateActivity(seed.vendorUser.id, seed.activity.id, { minGuests: 4 } as any))
      .rejects.toThrow(/Minimum guests/);
    const ok = await vendor.updateActivity(seed.vendorUser.id, seed.activity.id, { minGuests: 2 } as any);
    expect((ok as any).minGuests).toBe(2);
  });

  test('vendor create of a DAILY listing without a pricing model defaults to PER_UNIT', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    const created: any = await vendor.createActivity(seed.vendorUser.id, {
      titleEn: 'Beach Chalet', titleAr: 'شاليه', slug: 'beach-chalet-' + Math.random().toString(36).slice(2, 8),
      descriptionEn: 'desc', descriptionAr: 'وصف', categoryId: seed.category.id, cityId: seed.city.id,
      pricePerPerson: 900, bookingType: 'DAILY', capacity: 6,
      locationLat: 25.28, locationLng: 51.53, locationAddress: 'Doha',
      checkInTime: '14:00', checkOutTime: '11:00',
    } as any);
    expect(created.pricingModel).toBe('PER_UNIT');
    expect(created.minGuests).toBe(1);
  });

  test('admin update saves the minimum and validates it the same way', async () => {
    const seed = await seedReference(ctx.prisma);
    await makeCamp(seed.activity.id, { capacity: 60, minGuests: 1 });
    const admin = makeAdminService();
    await expect(admin.updateActivity(seed.activity.id, { minGuests: 61 } as any)).rejects.toThrow(/Minimum guests/);
    await admin.updateActivity(seed.activity.id, { minGuests: 2 } as any);
    const a = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: seed.activity.id } });
    expect(a.minGuests).toBe(2);
  });
});
