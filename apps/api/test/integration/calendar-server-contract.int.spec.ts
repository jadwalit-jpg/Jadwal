/**
 * Integration — the calendar must offer exactly what the server accepts.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Two failures on 2026-09-18 and one caught in review on 2026-09-23 were all
 * the SAME failure: the date picker and createBooking disagreed about which
 * dates are usable. Nobody noticed because each side was tested only against
 * itself.
 *
 *   picker refuses, server accepts  ->  lost bookings, silently
 *   picker offers, server refuses   ->  the customer fills in the whole form
 *                                       and fails at submission
 *
 * The second is worse than the first. Both are invisible to a test that
 * exercises one side alone, which is exactly what we had.
 *
 * So these tests pin the SERVER half of each rule the calendar now relies on.
 * The web suite (booking-calendar-selection / booking-calendar) pins the picker
 * half against the same scenarios. If either side is changed alone, one of the
 * two suites goes red.
 *
 * THE RULE THEY ENCODE
 * --------------------
 * A stay occupies [checkIn 14:00, checkOut 11:00). The departure date's night
 * belongs to the next guest. So the same calendar cell means different things:
 *
 *   another guest's booking   D 14:00 -> D+1 11:00   (arrives in the afternoon)
 *   a vendor's full-day block D 00:00 -> D+1 00:00   (the whole calendar day)
 *
 * Leaving on D at 11:00 misses the guest entirely but lands inside the block.
 * Hence: a BOOKED day is a valid check-out, a CLOSED day is not. They render
 * identically, which is precisely why this needs a test rather than a comment.
 */

import { getTestContext, seedReference } from './_setup';
import { BookingsService } from '../../src/bookings/bookings.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeBookingsService() {
  const prismaSvc = { client: ctx.prisma } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  const noopNotify = {
    send: jest.fn().mockResolvedValue(undefined),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
    sendToMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const redisLock = {
    acquire: jest.fn().mockResolvedValue('lock'),
    release: jest.fn().mockResolvedValue(undefined),
  } as any;
  const config = {
    get: (k: string, fb?: string) =>
      (({ RESERVATION_WINDOW_MINUTES: '15', BOOKING_MAX_ADVANCE_MONTHS: '6', REDIS_LOCK_TTL_MS: '30000' }) as Record<string, string>)[k] ?? fb,
  } as any;
  const cache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  return new BookingsService(
    prismaSvc, { log: jest.fn().mockResolvedValue(undefined) } as any, noopNotify, redisLock,
    config, loyalty, cache,
    { sendBookingOtp: jest.fn().mockResolvedValue(undefined) } as any,
    { tryConsume: jest.fn().mockResolvedValue(true) } as any,
    { log: jest.fn() } as any,
  );
}

/** A date N days out, as YYYY-MM-DD. */
function d(days: number): string {
  const x = new Date();
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
}

const PHONE = '+97455123456';

async function makeActivity(seed: any, overrides: Record<string, any>) {
  return ctx.prisma.activity.create({
    data: {
      vendorId: seed.vendor.id, categoryId: seed.category.id,
      countryId: seed.country.id, cityId: seed.city.id,
      titleEn: 'Contract', titleAr: 'ع', slug: 'contract-' + crypto.randomUUID().slice(0, 8),
      descriptionEn: 'd', descriptionAr: 'و', locationAddress: 'Doha',
      locationLat: 25.28, locationLng: 51.53,
      pricePerPerson: 100, coverImage: '/p.webp', status: 'ACTIVE',
      ...overrides,
    },
  });
}

/** A one-room DAILY activity: any overlap is a hard conflict, so the tests below
 *  fail loudly rather than quietly finding a second unit to sell. */
async function makeOneRoomDaily(seed: any, extra: Record<string, any> = {}) {
  return makeActivity(seed, {
    bookingType: 'DAILY', pricingModel: 'PER_UNIT',
    hasUnits: true, unitCount: 1, unitCapacity: 4, capacity: 4,
    checkInTime: '14:00', checkOutTime: '11:00',
    ...extra,
  });
}

async function makeCustomer() {
  return ctx.prisma.user.create({
    data: {
      fullName: 'C', email: `c-${crypto.randomUUID().slice(0, 6)}@t.com`,
      password: '$2b$10$dummy.hash', role: 'CUSTOMER', emailVerified: true,
    },
  });
}

/**
 * Block a whole calendar day, exactly as createActivityBlockCore does for the
 * vendor's "close this day" action: midnight to midnight, half-open.
 */
async function blockWholeDay(activityId: string, vendorId: string, date: string) {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return ctx.prisma.activityBlock.create({
    data: { activityId, vendorId, blockStart: start, blockEnd: end },
  });
}

async function book(svc: any, customerId: string, activityId: string, checkIn: string, checkOut: string) {
  return svc.createBooking(customerId, {
    activityId, checkInDate: checkIn, checkOutDate: checkOut,
    guests: 1, bookingPhone: PHONE,
  });
}

// ════════════════════════════════════════════════════════════════════════════

describe('DAILY — a BOOKED night is a valid check-out', () => {

  it('a stay ENDING on an occupied night is accepted', async () => {
    // The picker used to grey this out, so a one-night stay before an occupied
    // night could not be completed at all. The server was always willing.
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeOneRoomDaily(seed);
    const guestA = await makeCustomer();
    const guestB = await makeCustomer();

    // A sleeps the night of d(3): occupies d(3) 14:00 -> d(4) 11:00.
    await book(svc, guestA.id, act.id, d(3), d(4));

    // B leaves ON d(3) at 11:00 — three hours before A arrives.
    const res = await book(svc, guestB.id, act.id, d(2), d(3));
    expect(res.booking.id).toBeTruthy();
  });

  it('back-to-back stays fill the same single room with no gap', async () => {
    // The stronger form: three consecutive one-night stays in a ONE-unit
    // activity. If check-out/check-in were treated as overlapping, the second
    // would be refused for want of a free unit.
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeOneRoomDaily(seed);

    for (const day of [2, 3, 4]) {
      const guest = await makeCustomer();
      const res = await book(svc, guest.id, act.id, d(day), d(day + 1));
      expect(res.booking.unitNumber).toBe(1);
    }
    expect(await ctx.prisma.booking.count({ where: { activityId: act.id } })).toBe(3);
  });
});

describe('DAILY — a stay may not SPAN an occupied night', () => {

  it('a stay crossing an occupied night is refused', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeOneRoomDaily(seed);
    const guestA = await makeCustomer();
    const guestB = await makeCustomer();

    await book(svc, guestA.id, act.id, d(3), d(4));

    // d(2) -> d(5) swallows the night of d(3), which A holds.
    await expect(book(svc, guestB.id, act.id, d(2), d(5))).rejects.toThrow();
  });

  it('a stay STARTING on the occupied night is refused too', async () => {
    // The mirror image of the accepted case above — arriving consumes the
    // night, leaving does not.
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeOneRoomDaily(seed);
    const guestA = await makeCustomer();
    const guestB = await makeCustomer();

    await book(svc, guestA.id, act.id, d(3), d(4));
    await expect(book(svc, guestB.id, act.id, d(3), d(5))).rejects.toThrow();
  });
});

describe('DAILY — a VENDOR-CLOSED day is NOT a valid check-out', () => {

  it('leaving ON a fully-blocked day is refused, though leaving on a BOOKED day is not', async () => {
    // The asymmetry this whole file exists for. A guest arrives at 14:00, so a
    // 11:00 departure misses them. A block starts at 00:00, so the same 11:00
    // departure lands inside it.
    //
    // Nearly shipped as a dead end: the picker offered the closed day because
    // the API reports isFullyBooked for it, identically to a taken night.
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeOneRoomDaily(seed);
    const guest = await makeCustomer();

    await blockWholeDay(act.id, seed.vendor.id, d(3));

    await expect(book(svc, guest.id, act.id, d(2), d(3)))
      .rejects.toThrow(/not available for booking/i);
  });

  it('arriving on a fully-blocked day is refused', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeOneRoomDaily(seed);
    const guest = await makeCustomer();

    await blockWholeDay(act.id, seed.vendor.id, d(3));
    await expect(book(svc, guest.id, act.id, d(3), d(4))).rejects.toThrow();
  });

  it('a stay clear of the blocked day is still accepted', async () => {
    // The guard must not overreach: a block must not poison its neighbours.
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeOneRoomDaily(seed);
    const guest = await makeCustomer();

    await blockWholeDay(act.id, seed.vendor.id, d(3));
    const res = await book(svc, guest.id, act.id, d(4), d(5));
    expect(res.booking.id).toBeTruthy();
  });

  it('the calendar reports a blocked day as BOTH isBlocked and isFullyBooked', async () => {
    // This is the fact the picker reads, and the reason it cannot tell a closed
    // day from a taken one on isFullyBooked alone. Pinned so that if the API
    // ever stops setting both flags, the web-side rule is revisited with it.
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeOneRoomDaily(seed);

    const blocked = d(3);
    await blockWholeDay(act.id, seed.vendor.id, blocked);

    const cal: any = await svc.getCalendarAvailability(act.id, blocked.slice(0, 7));
    const day = cal.days.find((x: any) => x.date === blocked);
    expect(day).toBeDefined();
    expect(day.isBlocked).toBe(true);
    expect(day.isFullyBooked).toBe(true);
  });

  it('a guest-BOOKED day reports isFullyBooked but NOT isBlocked', async () => {
    // The contrast. Same isFullyBooked, different isBlocked — which is the only
    // signal the picker has to tell the two apart.
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeOneRoomDaily(seed);
    const guest = await makeCustomer();

    const taken = d(3);
    await book(svc, guest.id, act.id, taken, d(4));

    const cal: any = await svc.getCalendarAvailability(act.id, taken.slice(0, 7));
    const day = cal.days.find((x: any) => x.date === taken);
    expect(day).toBeDefined();
    expect(day.isFullyBooked).toBe(true);
    expect(day.isBlocked).toBeFalsy();
  });
});

describe('DAILY — minimum stay is a FLOOR, not a fixed length', () => {

  it('a stay LONGER than durationValue is accepted and priced per night', async () => {
    // schema.prisma calls durationValue "nights (DAILY fixed)", but
    // createBooking enforces it as a minimum. Worth pinning: a reader trusting
    // the schema comment might "fix" this into an equality check and refuse
    // every longer stay.
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeOneRoomDaily(seed, { durationValue: 2 });
    const guest = await makeCustomer();

    const res = await book(svc, guest.id, act.id, d(2), d(6)); // 4 nights, min 2
    expect(res.booking.id).toBeTruthy();
  });

  it('a stay SHORTER than durationValue is refused', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeOneRoomDaily(seed, { durationValue: 3 });
    const guest = await makeCustomer();

    await expect(book(svc, guest.id, act.id, d(2), d(3)))
      .rejects.toThrow(/minimum stay/i);
  });
});
