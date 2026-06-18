/**
 * Integration — DAILY minimum-nights (durationValue = minimum, mirrors HOURLY).
 *
 * Covers: a stay shorter than the minimum is rejected; exactly the minimum and
 * longer (extended) are accepted and priced per night; a flexible activity
 * (durationValue=null) allows any stay ≥ 1; the MAX_BOOKING_NIGHTS cap rejects
 * an abusive range; and a special-price night composes with an extended stay.
 */

import { getTestContext, seedReference } from './_setup';
import { VendorService } from '../../src/vendor/vendor.service';
import { BookingsService } from '../../src/bookings/bookings.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

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

  const vendor = new VendorService(prismaSvc, notificationService, loyalty, availabilityCache);
  const bookings = new BookingsService(
    prismaSvc, auditLogger, notificationService, redisLock,
    configService, loyalty, availabilityCache,
    { sendBookingOtp: jest.fn().mockResolvedValue(undefined) } as any,
    { tryConsume: jest.fn().mockResolvedValue(true) } as any,
    { log: jest.fn() } as any,
  );
  return { vendor, bookings };
}

function futureDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Make seed.activity a DAILY activity with the given minimum nights (null = flexible). */
async function makeDaily(activityId: string, minNights: number | null) {
  await ctx.prisma.activity.update({
    where: { id: activityId },
    data: {
      bookingType: 'DAILY', pricingModel: 'PER_UNIT', pricePerPerson: 100,
      durationValue: minNights, checkInTime: '14:00', checkOutTime: '11:00',
      capacity: 10, hasUnits: false, activeDays: [],
    },
  });
}

async function book(bookings: any, customerId: string, activityId: string, checkInDate: string, checkOutDate: string) {
  return bookings.createBooking(customerId, {
    activityId, checkInDate, checkOutDate, guests: 1, bookingPhone: '+97455123456',
  } as any);
}

describe('DAILY minimum nights', () => {
  test('rejects a stay shorter than the minimum', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();
    await makeDaily(seed.activity.id, 3);
    // 2 nights < min 3
    await expect(book(bookings, seed.customer.id, seed.activity.id, futureDate(10), futureDate(12)))
      .rejects.toThrow(/minimum stay of 3/i);
  });

  test('accepts exactly the minimum, priced per night', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();
    await makeDaily(seed.activity.id, 3);
    const res: any = await book(bookings, seed.customer.id, seed.activity.id, futureDate(10), futureDate(13)); // 3 nights
    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: res.booking.id } });
    expect(Number(b.totalPrice)).toBe(300); // 3 × 100
  });

  test('accepts an extended stay (more than the minimum)', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();
    await makeDaily(seed.activity.id, 3);
    const res: any = await book(bookings, seed.customer.id, seed.activity.id, futureDate(20), futureDate(25)); // 5 nights
    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: res.booking.id } });
    expect(Number(b.totalPrice)).toBe(500); // 5 × 100
  });

  test('flexible activity (durationValue=null) allows a single night', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();
    await makeDaily(seed.activity.id, null);
    const res: any = await book(bookings, seed.customer.id, seed.activity.id, futureDate(10), futureDate(11)); // 1 night
    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: res.booking.id } });
    expect(Number(b.totalPrice)).toBe(100);
  });

  test('rejects a stay exceeding the MAX_BOOKING_NIGHTS cap', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();
    await makeDaily(seed.activity.id, null);
    // 91 nights > cap (90); check-in still within the 6-month advance window.
    await expect(book(bookings, seed.customer.id, seed.activity.id, futureDate(5), futureDate(96)))
      .rejects.toThrow(/cannot exceed/i);
  });

  test('extended stay composes with a per-date special price', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor, bookings } = makeServices();
    await makeDaily(seed.activity.id, 2); // min 2 nights
    const night1 = futureDate(30);
    await vendor.createActivitySpecialPrice(seed.vendorUser.id, seed.activity.id, { date: night1, price: 150 });
    // Book 3 nights (extend past the min): night1 special (150) + 2 base (100+100) = 350.
    const res: any = await book(bookings, seed.customer.id, seed.activity.id, night1, futureDate(33));
    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: res.booking.id } });
    expect(Number(b.totalPrice)).toBe(350);
  });
});
