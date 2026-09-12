/**
 * Integration — `assignMissingUnits`: hand a unit to bookings that predate an
 * activity's unit configuration.
 *
 * Companion to booking-unit-null-invisible.int.spec.ts, which pins the DEFECT.
 * This file pins the PREVENTION: flipping the unit option on must not leave
 * existing confirmed guests invisible.
 *
 * The cases below exist because each one is a way this could go wrong:
 *   - silently moving a guest who already has a unit (vendor planned around it)
 *   - forcing a booking into a unit that is already occupied (hides overselling)
 *   - treating check-out-then-check-in the same day as a clash (loses a sale)
 *   - touching activities that do not use units at all
 *   - packing per-person units as if they were whole-unit rentals
 */

import { getTestContext, seedReference } from './_setup';
import { assignMissingUnits } from '../../src/bookings/assign-missing-units';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

/** YYYY-MM-DD, N days from today (UTC). Negative = the past. */
function d(daysFromNow: number): string {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() + daysFromNow);
  return dt.toISOString().slice(0, 10);
}
const at = (dateStr: string, time: string) => new Date(`${dateStr}T${time}:00.000Z`);

async function makeActivity(seed: any, over: Record<string, unknown> = {}) {
  return ctx.prisma.activity.create({
    data: {
      vendorId: seed.vendor.id, categoryId: seed.category.id,
      countryId: seed.country.id, cityId: seed.city.id,
      titleEn: 'Place', titleAr: 'مكان',
      slug: 'place-' + crypto.randomUUID().slice(0, 8),
      descriptionEn: 'd', descriptionAr: 'و',
      locationAddress: 'Doha', locationLat: 25.28, locationLng: 51.53,
      bookingType: 'DAILY', pricingModel: 'PER_UNIT',
      pricePerPerson: 1000,
      hasUnits: false, unitCount: 0, unitCapacity: 10, capacity: 10,
      durationValue: null,
      checkInTime: '15:00', checkOutTime: '12:00',
      coverImage: '/p.webp', status: 'ACTIVE',
      ...over,
    },
  });
}

/**
 * Insert a booking directly. Bypassing createBooking is the point: we are
 * recreating rows that ALREADY exist in the database from before the unit
 * option was switched on, which createBooking can no longer produce for a
 * units activity.
 */
async function seedBooking(
  seed: any, activityId: string,
  startDate: string, endDate: string,
  opts: {
    unitNumber?: number | null; guests?: number; status?: string;
    /** Override for HOURLY activities, where both dates are the same day. */
    startTime?: string; endTime?: string;
  } = {},
) {
  const startDatetime = at(startDate, opts.startTime ?? '15:00');
  const endDatetime = at(endDate, opts.endTime ?? '12:00');
  // A window that ends before it starts overlaps NOTHING, so every assertion
  // built on it passes for the wrong reason. Caught exactly that while writing
  // these tests (same-day dates against the default 15:00→12:00 check-in/out),
  // so fail loudly instead of quietly proving nothing.
  if (endDatetime <= startDatetime) {
    throw new Error(
      `seedBooking: endDatetime (${endDatetime.toISOString()}) must be after ` +
        `startDatetime (${startDatetime.toISOString()}). For a same-day HOURLY ` +
        `booking pass startTime/endTime explicitly.`,
    );
  }
  return ctx.prisma.booking.create({
    data: {
      ref: 'JDWL-' + crypto.randomUUID().slice(0, 8).toUpperCase(),
      activityId,
      customerId: seed.customer.id,
      vendorId: seed.vendor.id,
      startDatetime,
      endDatetime,
      guests: opts.guests ?? 2,
      unitNumber: opts.unitNumber ?? null,
      status: (opts.status ?? 'CONFIRMED') as never,
      totalPrice: 1000,
      serviceFee: 0,
      bookingPhone: '+97455123456',
    },
  });
}

const unitOf = async (id: string) =>
  (await ctx.prisma.booking.findUnique({ where: { id }, select: { unitNumber: true } }))!.unitNumber;

// ═══════════════════════════════════════════════════════════════════════════

describe('assignMissingUnits — the core behaviour', () => {

  test('gives a unit to a booking that predates the unit option', async () => {
    const seed = await seedReference(ctx.prisma);
    const act = await makeActivity(seed);
    const b = await seedBooking(seed, act.id, d(5), d(7));

    expect(await unitOf(b.id)).toBeNull();

    // Staff switch units on, then the backfill runs in the same transaction.
    await ctx.prisma.activity.update({
      where: { id: act.id }, data: { hasUnits: true, unitCount: 1, unitCapacity: 10 },
    });
    const res = await assignMissingUnits(ctx.prisma as never, act.id);

    expect(res).toEqual({ skipped: false, assigned: 1, unassignable: [] });
    expect(await unitOf(b.id)).toBe(1);
  });

  test('does nothing for an activity that does not use units', async () => {
    const seed = await seedReference(ctx.prisma);
    const act = await makeActivity(seed); // hasUnits stays false
    const b = await seedBooking(seed, act.id, d(5), d(7));

    const res = await assignMissingUnits(ctx.prisma as never, act.id);

    expect(res.skipped).toBe(true);
    expect(res.assigned).toBe(0);
    // null is CORRECT here — this activity counts guests, not units.
    expect(await unitOf(b.id)).toBeNull();
  });

  test('is idempotent — a second run changes nothing', async () => {
    const seed = await seedReference(ctx.prisma);
    const act = await makeActivity(seed, { hasUnits: true, unitCount: 3, unitCapacity: 10 });
    const b1 = await seedBooking(seed, act.id, d(5), d(7));
    const b2 = await seedBooking(seed, act.id, d(6), d(8));

    const first = await assignMissingUnits(ctx.prisma as never, act.id);
    const layout = [await unitOf(b1.id), await unitOf(b2.id)];

    const second = await assignMissingUnits(ctx.prisma as never, act.id);

    expect(first.assigned).toBe(2);
    expect(second.assigned).toBe(0);
    expect([await unitOf(b1.id), await unitOf(b2.id)]).toEqual(layout);
  });
});

describe('assignMissingUnits — must not disturb what is already there', () => {

  test('never moves a booking that already holds a unit', async () => {
    const seed = await seedReference(ctx.prisma);
    const act = await makeActivity(seed, { hasUnits: true, unitCount: 3, unitCapacity: 10 });

    // Already on unit 2 — the vendor has planned around this.
    const fixed = await seedBooking(seed, act.id, d(5), d(7), { unitNumber: 2 });
    const orphan = await seedBooking(seed, act.id, d(5), d(7));

    const res = await assignMissingUnits(ctx.prisma as never, act.id);

    expect(await unitOf(fixed.id)).toBe(2);      // untouched
    expect([1, 3]).toContain(await unitOf(orphan.id)); // packed around it
    expect(res.assigned).toBe(1);
  });

  test('leaves past bookings alone', async () => {
    const seed = await seedReference(ctx.prisma);
    const act = await makeActivity(seed, { hasUnits: true, unitCount: 1, unitCapacity: 10 });
    const over = await seedBooking(seed, act.id, d(-10), d(-8));
    const future = await seedBooking(seed, act.id, d(5), d(7));

    const res = await assignMissingUnits(ctx.prisma as never, act.id);

    // A finished stay cannot be double-sold and is not reachable in any
    // availability window a customer can book, so it is not rewritten.
    expect(await unitOf(over.id)).toBeNull();
    expect(await unitOf(future.id)).toBe(1);
    expect(res.assigned).toBe(1);
  });

  test('ignores cancelled bookings', async () => {
    const seed = await seedReference(ctx.prisma);
    const act = await makeActivity(seed, { hasUnits: true, unitCount: 1, unitCapacity: 10 });
    const dead = await seedBooking(seed, act.id, d(5), d(7), { status: 'CANCELLED' });
    const live = await seedBooking(seed, act.id, d(5), d(7));

    const res = await assignMissingUnits(ctx.prisma as never, act.id);

    expect(await unitOf(dead.id)).toBeNull();
    // The cancelled one must not have consumed the only unit.
    expect(await unitOf(live.id)).toBe(1);
    expect(res.assigned).toBe(1);
  });
});

describe('assignMissingUnits — overlap semantics match the rest of the system', () => {

  test('check-out and check-in on the same day share one unit', async () => {
    const seed = await seedReference(ctx.prisma);
    const act = await makeActivity(seed, { hasUnits: true, unitCount: 1, unitCapacity: 10 });

    // First leaves d(7) at 12:00, second arrives d(7) at 15:00 — not an overlap
    // under the strict predicate used everywhere else. Treating this as a clash
    // would cost a real, bookable night.
    const a = await seedBooking(seed, act.id, d(5), d(7));
    const b = await seedBooking(seed, act.id, d(7), d(9));

    const res = await assignMissingUnits(ctx.prisma as never, act.id);

    expect(await unitOf(a.id)).toBe(1);
    expect(await unitOf(b.id)).toBe(1); // same unit, back to back
    expect(res.unassignable).toEqual([]);
  });

  test('genuinely overlapping stays take separate units', async () => {
    const seed = await seedReference(ctx.prisma);
    const act = await makeActivity(seed, { hasUnits: true, unitCount: 2, unitCapacity: 10 });
    const a = await seedBooking(seed, act.id, d(5), d(9));
    const b = await seedBooking(seed, act.id, d(6), d(8)); // inside a's range

    await assignMissingUnits(ctx.prisma as never, act.id);

    const [ua, ub] = [await unitOf(a.id), await unitOf(b.id)];
    expect(ua).not.toBeNull();
    expect(ub).not.toBeNull();
    expect(ua).not.toBe(ub);
  });

  test('throws rather than leaving a booking unplaced', async () => {
    const seed = await seedReference(ctx.prisma);
    const act = await makeActivity(seed, { hasUnits: true, unitCount: 1, unitCapacity: 10 });

    // Two overlapping stays, one unit. The data is already oversold.
    const a = await seedBooking(seed, act.id, d(5), d(9));
    const b = await seedBooking(seed, act.id, d(6), d(8));

    // Placing one and leaving the other null would make things WORSE, not
    // neutral: a null-unit booking is invisible to the unit-counting paths, so
    // the capacity it occupies reads as free and can be sold again. Refuse the
    // whole operation instead — the caller runs this inside the activity-update
    // transaction, so the switch does not flip either.
    await expect(assignMissingUnits(ctx.prisma as never, act.id)).rejects.toThrow(
      /cannot fit|Resolve those bookings/i,
    );

    // Both left exactly as they were.
    expect(await unitOf(a.id)).toBeNull();
    expect(await unitOf(b.id)).toBeNull();
  });

  test('throws when a live booking sits above a reduced unitCount', async () => {
    const seed = await seedReference(ctx.prisma);
    const act = await makeActivity(seed, { hasUnits: true, unitCount: 3, unitCapacity: 10 });

    // Valid while there were 3 units.
    const stranded = await seedBooking(seed, act.id, d(5), d(7), { unitNumber: 3 });

    // Now the vendor shrinks to 1 unit. Availability only ever scans units
    // 1..unitCount, so this guest's nights would read as free and be resold.
    await ctx.prisma.activity.update({ where: { id: act.id }, data: { unitCount: 1 } });

    await expect(assignMissingUnits(ctx.prisma as never, act.id)).rejects.toThrow(
      /reduce the number of units|Cancel or move/i,
    );

    // Not silently remapped — moving a guest is a human decision.
    expect(await unitOf(stranded.id)).toBe(3);
  });

  test('a reduction that strands nobody is allowed through', async () => {
    const seed = await seedReference(ctx.prisma);
    const act = await makeActivity(seed, { hasUnits: true, unitCount: 3, unitCapacity: 10 });
    const safe = await seedBooking(seed, act.id, d(5), d(7), { unitNumber: 1 });

    await ctx.prisma.activity.update({ where: { id: act.id }, data: { unitCount: 2 } });

    // The guard must block the harmful case WITHOUT blocking ordinary edits.
    const res = await assignMissingUnits(ctx.prisma as never, act.id);
    expect(res.unassignable).toEqual([]);
    expect(await unitOf(safe.id)).toBe(1);
  });
});

describe('assignMissingUnits — per-person units share, whole units do not', () => {

  test('per-person units pack multiple guests into one unit up to capacity', async () => {
    const seed = await seedReference(ctx.prisma);
    // HOURLY + PER_PERSON with units → rentsWholeUnit() is false, so a unit is
    // shared by seat (mirrors the Desert Safari activity in production).
    const act = await makeActivity(seed, {
      bookingType: 'HOURLY', pricingModel: 'PER_PERSON',
      hasUnits: true, unitCount: 2, unitCapacity: 6, capacity: 12,
      durationValue: 2, checkInTime: '09:00', checkOutTime: '21:00',
    });

    const slot = { startTime: '09:00', endTime: '11:00' };
    const a = await seedBooking(seed, act.id, d(5), d(5), { guests: 2, ...slot });
    const b = await seedBooking(seed, act.id, d(5), d(5), { guests: 3, ...slot });

    const res = await assignMissingUnits(ctx.prisma as never, act.id);

    // 2 + 3 = 5 ≤ 6, so both belong in unit 1 — a whole-unit rule would have
    // wasted unit 2 here.
    expect(res.assigned).toBe(2);
    expect(await unitOf(a.id)).toBe(1);
    expect(await unitOf(b.id)).toBe(1);
  });

  test('per-person units overflow to the next unit past capacity', async () => {
    const seed = await seedReference(ctx.prisma);
    const act = await makeActivity(seed, {
      bookingType: 'HOURLY', pricingModel: 'PER_PERSON',
      hasUnits: true, unitCount: 2, unitCapacity: 6, capacity: 12,
      durationValue: 2, checkInTime: '09:00', checkOutTime: '21:00',
    });

    const slot = { startTime: '09:00', endTime: '11:00' };
    const a = await seedBooking(seed, act.id, d(5), d(5), { guests: 5, ...slot });
    const b = await seedBooking(seed, act.id, d(5), d(5), { guests: 4, ...slot });

    await assignMissingUnits(ctx.prisma as never, act.id);

    expect(await unitOf(a.id)).toBe(1);
    expect(await unitOf(b.id)).toBe(2); // 5 + 4 = 9 > 6
  });

  test('whole-unit rentals never share, however few the guests', async () => {
    const seed = await seedReference(ctx.prisma);
    // DAILY + units → whole-unit. One guest still owns the entire place.
    const act = await makeActivity(seed, { hasUnits: true, unitCount: 2, unitCapacity: 25 });

    const a = await seedBooking(seed, act.id, d(5), d(7), { guests: 1 });
    const b = await seedBooking(seed, act.id, d(5), d(7), { guests: 1 });

    await assignMissingUnits(ctx.prisma as never, act.id);

    // Two guests, plenty of headroom per unit, but a room is a room.
    expect(await unitOf(a.id)).toBe(1);
    expect(await unitOf(b.id)).toBe(2);
  });
});
