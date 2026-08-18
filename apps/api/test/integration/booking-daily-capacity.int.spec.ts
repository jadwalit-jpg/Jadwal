/**
 * Integration — DAILY booking capacity enforcement + HOURLY end-touching-start.
 *
 * Fills the coverage gaps left by the HOURLY-only booking-create.int.spec.ts:
 *
 *  1. DAILY non-unit: guests accumulate per overlapping window → over-cap rejected.
 *  2. DAILY non-unit: separate (non-overlapping) windows don't interfere with each other.
 *  3. DAILY non-unit: partially-overlapping stays saturate capacity inside the overlap.
 *  4. DAILY non-unit staggered (time-disjoint): getDailyAvailability uses SUM → under-
 *     reports available seats; createBooking uses maxConcurrentInWindow → correct.
 *     This test documents the KNOWN asymmetry so regressions are caught if either side
 *     diverges unexpectedly.
 *  5. HOURLY: a booking ending at T and a new booking starting at T are NOT counted as
 *     concurrent (end-event processed before start-event at same instant). This allows
 *     back-to-back slots to fill independently up to capacity.
 *  6. Multi-date: booking spans 5 nights; a new single-night booking that shares only
 *     one of those nights is correctly rejected when capacity is full for that night.
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
  const redisLock = {
    acquire: jest.fn().mockResolvedValue('lock-token'),
    release: jest.fn().mockResolvedValue(undefined),
  } as any;
  const config = {
    get: (k: string, fb?: string) =>
      (({ RESERVATION_WINDOW_MINUTES: '15', BOOKING_MAX_ADVANCE_YEARS: '2', REDIS_LOCK_TTL_MS: '30000' }) as Record<string, string>)[k] ?? fb,
  } as any;
  return new BookingsService(
    prismaSvc,
    { log: jest.fn().mockResolvedValue(undefined) } as any,
    { send: jest.fn().mockResolvedValue(undefined), notifyAdmins: jest.fn(), sendToMany: jest.fn() } as any,
    redisLock, config, loyalty,
    { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any,
    { sendBookingOtp: jest.fn().mockResolvedValue(undefined) } as any,
    { tryConsume: jest.fn().mockResolvedValue(true) } as any,
    { log: jest.fn() } as any,
  );
}

/** YYYY-MM-DD for N days from today (UTC). */
function d(daysFromNow: number): string {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() + daysFromNow);
  return dt.toISOString().slice(0, 10);
}

const PHONE = '+97455123456';

/** Create a DAILY activity without units (capacity-only). durationValue null = flexible nights. */
async function makeDailyActivity(seed: any, capacity: number) {
  return ctx.prisma.activity.create({
    data: {
      vendorId: seed.vendor.id, categoryId: seed.category.id,
      countryId: seed.country.id, cityId: seed.city.id,
      titleEn: 'Stay', titleAr: 'إقامة',
      slug: 'stay-' + crypto.randomUUID().slice(0, 8),
      descriptionEn: 'd', descriptionAr: 'و',
      locationAddress: 'Doha', locationLat: 25.28, locationLng: 51.53,
      bookingType: 'DAILY', pricingModel: 'PER_UNIT',
      pricePerPerson: 200, capacity,
      hasUnits: false,
      durationValue: null,          // flexible night count
      checkInTime: '14:00', checkOutTime: '11:00',
      coverImage: '/p.webp', status: 'ACTIVE',
    },
  });
}

async function makeCustomer() {
  return ctx.prisma.user.create({
    data: {
      fullName: 'C', email: `c-${crypto.randomUUID().slice(0, 6)}@t.com`,
      password: '$2b$10$dummy', role: 'CUSTOMER', emailVerified: true,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. DAILY non-unit — same-window guests accumulate; over-capacity rejected
// ═══════════════════════════════════════════════════════════════════════════

describe('DAILY non-unit — same-window capacity accumulation', () => {
  test('two bookings fill capacity; third rejected; fourth on separate window succeeds', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeDailyActivity(seed, 10);
    const c2 = await makeCustomer();
    const c3 = await makeCustomer();
    const c4 = await makeCustomer();

    const ci = d(7), co = d(9); // same 2-night window for A, B, C

    // A: 6 guests ✓
    const a = await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: ci, checkOutDate: co, guests: 6, bookingPhone: PHONE,
    });
    expect(a.booking.status).toBe('PENDING');

    // B: 4 more guests → now at capacity (6+4=10) ✓
    const b = await svc.createBooking(c2.id, {
      activityId: act.id, checkInDate: ci, checkOutDate: co, guests: 4, bookingPhone: PHONE,
    });
    expect(b.booking.status).toBe('PENDING');

    // C: any extra guest → over capacity → REJECTED
    await expect(
      svc.createBooking(c3.id, {
        activityId: act.id, checkInDate: ci, checkOutDate: co, guests: 1, bookingPhone: PHONE,
      }),
    ).rejects.toThrow(/fully booked|not enough|available/i);

    // D: completely separate window (next week) → full 10 seats available
    const d2 = await svc.createBooking(c4.id, {
      activityId: act.id, checkInDate: d(14), checkOutDate: d(16), guests: 10, bookingPhone: PHONE,
    });
    expect(d2.booking.status).toBe('PENDING');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. DAILY non-unit — adjacent (non-overlapping) windows don't interfere
// ═══════════════════════════════════════════════════════════════════════════

describe('DAILY non-unit — adjacent stays: checkout day ≠ check-in day (no overlap)', () => {
  test('first stay ends Wed morning; second starts Wed afternoon — no interference', async () => {
    // checkOutTime=11:00, checkInTime=14:00 → A.endDatetime (Wed 11:00) < B.startDatetime (Wed 14:00)
    // so they do NOT overlap in the DB query or sweep-line.
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeDailyActivity(seed, 5);
    const c2 = await makeCustomer();

    const stayA_ci = d(7), stayA_co = d(9);   // Mon → Wed
    const stayB_ci = d(9), stayB_co = d(11);   // Wed → Fri

    // A fills almost all capacity
    await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: stayA_ci, checkOutDate: stayA_co, guests: 5, bookingPhone: PHONE,
    });

    // B starts exactly when A's checkout day begins — different part of the day (14:00 vs 11:00)
    // so the windows don't overlap → B sees 0 existing guests → full capacity available
    const b = await svc.createBooking(c2.id, {
      activityId: act.id, checkInDate: stayB_ci, checkOutDate: stayB_co, guests: 5, bookingPhone: PHONE,
    });
    expect(b.booking.status).toBe('PENDING');

    // Both exist — no conflict
    expect(await ctx.prisma.booking.count()).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. DAILY non-unit — partial window overlap saturates capacity in overlap zone
// ═══════════════════════════════════════════════════════════════════════════

describe('DAILY non-unit — partial overlap saturates capacity in the shared nights', () => {
  test('A Mon-Thu + B Tue-Fri each take 3 seats; overlap zone maxes out at 6; C Tue-Thu with 5 rejected', async () => {
    // A: Mon 14:00 → Thu 11:00, guests=3  (succeeds, peak in window=3)
    // B: Tue 14:00 → Fri 11:00, guests=3  (peak in Tue-Fri window includes A → 3+3=6, available=4 → B(3) succeeds)
    // C: Tue 14:00 → Thu 11:00, guests=5  (peak over Tue-Thu = 3+3=6, available=4, 5>4 → REJECTED)
    // D: Tue 14:00 → Thu 11:00, guests=4  (4=available → SUCCEEDS)
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeDailyActivity(seed, 10);
    const c2 = await makeCustomer();
    const c3 = await makeCustomer();
    const c4 = await makeCustomer();

    // A: Mon → Thu (3 nights)
    const a = await svc.createBooking(seed.customer.id, {
      activityId: act.id,
      checkInDate: d(7), checkOutDate: d(10),
      guests: 3, bookingPhone: PHONE,
    });
    expect(a.booking.status).toBe('PENDING');

    // B: Tue → Fri (3 nights, overlaps A); A contributes 3 to the Tue-Fri window peak
    const b = await svc.createBooking(c2.id, {
      activityId: act.id,
      checkInDate: d(8), checkOutDate: d(11),
      guests: 3, bookingPhone: PHONE,
    });
    expect(b.booking.status).toBe('PENDING');

    // C: Tue → Thu (overlap zone); peak=3(A)+3(B)=6, available=4, requested=5 → REJECTED
    await expect(
      svc.createBooking(c3.id, {
        activityId: act.id,
        checkInDate: d(8), checkOutDate: d(10),
        guests: 5, bookingPhone: PHONE,
      }),
    ).rejects.toThrow(/fully booked|not enough|available/i);

    // D: Tue → Thu, 4 guests → exactly available (4=available) → SUCCEEDS
    const dd = await svc.createBooking(c4.id, {
      activityId: act.id,
      checkInDate: d(8), checkOutDate: d(10),
      guests: 4, bookingPhone: PHONE,
    });
    expect(dd.booking.status).toBe('PENDING');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. DAILY staggered (time-disjoint): SUM asymmetry documented
// ═══════════════════════════════════════════════════════════════════════════

describe('DAILY non-unit staggered stays — known SUM/sweep-line asymmetry', () => {
  test('getDailyAvailability under-reports for wide window; createBooking uses peak (correct)', async () => {
    // A: Mon 14:00 → Wed 11:00, guests=7  (ends before B starts)
    // B: Wed 14:00 → Fri 11:00, guests=7  (starts after A ends)
    // Neither A nor B are ever concurrent — peak concurrency = 7 (not 14).
    //
    // getDailyAvailability(Mon, Fri) uses _sum.guests → reports booked=14, available=0.
    // createBooking(Mon, Fri) uses maxConcurrentInWindow → peak=7, available=3 → SUCCEEDS.
    //
    // This is a DOCUMENTED behavior (code comment in getDailyAvailability).
    // The UI may show "no availability" even when seats exist. The booking path
    // is always correct and will never wrongly reject a valid booking.
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeDailyActivity(seed, 10);
    const c2 = await makeCustomer();
    const c3 = await makeCustomer();
    const c4 = await makeCustomer();

    // A: Mon → Wed (Mon 14:00 → Wed 11:00)
    await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: d(7), checkOutDate: d(9), guests: 7, bookingPhone: PHONE,
    });

    // B: Wed → Fri (Wed 14:00 → Fri 11:00) — starts AFTER A ends; no overlap
    await svc.createBooking(c2.id, {
      activityId: act.id, checkInDate: d(9), checkOutDate: d(11), guests: 7, bookingPhone: PHONE,
    });

    // getDailyAvailability over the wide Mon→Fri window: SUM = 14, available = 0 (under-report)
    const avail = await svc.getDailyAvailability(act.id, d(7), d(11)) as any;
    expect(avail.booked).toBe(14);       // SUM of both bookings
    expect(avail.available).toBe(0);     // under-reports (staggered bookings sum past capacity)

    // createBooking Mon→Fri, 3 guests: peak is only 7 (A and B never overlap)
    // → available = 10-7 = 3 → SUCCEEDS (correct)
    const c = await svc.createBooking(c3.id, {
      activityId: act.id, checkInDate: d(7), checkOutDate: d(11), guests: 3, bookingPhone: PHONE,
    });
    expect(c.booking.status).toBe('PENDING');

    // 4th booking Mon→Fri, 1 guest: peak is now 7+3=10 (C overlaps both A and B)
    // → available = 10-10 = 0 → REJECTED
    await expect(
      svc.createBooking(c4.id, {
        activityId: act.id, checkInDate: d(7), checkOutDate: d(11), guests: 1, bookingPhone: PHONE,
      }),
    ).rejects.toThrow(/fully booked|not enough|available/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. HOURLY — end-touching-start: slots ending at T and starting at T are NOT concurrent
// ═══════════════════════════════════════════════════════════════════════════

describe('HOURLY — end-touching-start boundary', () => {
  test('A fills capacity at 10:00-12:00; B fills capacity at 12:00-14:00 (touching, not overlapping)', async () => {
    // The sweep-line sorts end-events BEFORE start-events at the same instant.
    // A.endDatetime = 12:00 (delta -N) is processed before B.startDatetime = 12:00 (delta +N).
    // So A.peak and B.peak are independent — each slot can hold capacity seats.
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    // activity capacity=3, duration=2h (09:00-21:00 from seedReference)
    await ctx.prisma.activity.update({
      where: { id: seed.activity.id }, data: { capacity: 3 },
    });

    const date = d(7);
    const customers = await Promise.all(Array.from({ length: 6 }, () => makeCustomer()));

    // Fill 10:00 slot (3 of 3 seats)
    for (let i = 0; i < 3; i++) {
      await svc.createBooking(customers[i].id, {
        activityId: seed.activity.id, checkInDate: date, slotTime: '10:00', guests: 1, bookingPhone: PHONE,
      });
    }

    // 10:00 slot now fully booked — sanity check
    await expect(
      svc.createBooking(customers[3].id, {
        activityId: seed.activity.id, checkInDate: date, slotTime: '10:00', guests: 1, bookingPhone: PHONE,
      }),
    ).rejects.toThrow();

    // 12:00 slot (starts exactly when 10:00 ends) must be fully available
    for (let i = 3; i < 6; i++) {
      const res = await svc.createBooking(customers[i].id, {
        activityId: seed.activity.id, checkInDate: date, slotTime: '12:00', guests: 1, bookingPhone: PHONE,
      });
      expect(res.booking.status).toBe('PENDING');
    }

    expect(await ctx.prisma.booking.count()).toBe(6); // 3 at 10:00 + 3 at 12:00
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Multi-date booking + single-night booking that overlaps one night only
// ═══════════════════════════════════════════════════════════════════════════

describe('DAILY non-unit — multi-night stay + single-night overlap', () => {
  test('5-night stay fills capacity; single-night booking that overlaps one of those nights is rejected', async () => {
    // A books nights 1-5 (Mon-Sat), guests=10 (fills capacity=10)
    // B tries nights 3-4 (Wed-Thu, one night inside A's window) → peak=10, rejected
    // C tries nights 6-7 (Sat-Sun, after A ends) → peak=0, succeeds
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeDailyActivity(seed, 10);
    const c2 = await makeCustomer();
    const c3 = await makeCustomer();

    // A: nights 1-5 (5 nights, capacity filled)
    await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: d(7), checkOutDate: d(12), guests: 10, bookingPhone: PHONE,
    });

    // B: single night (night 3) — overlaps A → REJECTED
    await expect(
      svc.createBooking(c2.id, {
        activityId: act.id, checkInDate: d(10), checkOutDate: d(11), guests: 1, bookingPhone: PHONE,
      }),
    ).rejects.toThrow(/fully booked|not enough|available/i);

    // C: night after A ends — A.endDatetime = d(12) at 11:00, C.startDatetime = d(12) at 14:00
    // → C.start > A.end → no overlap → succeeds
    const c = await svc.createBooking(c3.id, {
      activityId: act.id, checkInDate: d(12), checkOutDate: d(13), guests: 10, bookingPhone: PHONE,
    });
    expect(c.booking.status).toBe('PENDING');
  });
});
