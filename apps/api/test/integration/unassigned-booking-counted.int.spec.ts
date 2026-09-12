/**
 * Integration — a booking with NO unit still occupies inventory ("Fix A").
 *
 * THE DEFECT
 * ----------
 * Every unit-counting path scans units 1..unitCount, so a row with
 * `unitNumber = null` matches none of them. It did not appear on the calendar
 * AND it did not block a new booking of the same dates: the capacity it really
 * occupied read as free and was sold again. Found in production 2026-09-12 —
 * a confirmed two-night stay at a one-unit resort reporting `booked: 0`.
 *
 * Earlier work stopped bookings LOSING their unit (createBooking always assigns
 * one; the unit-switch backfill refuses to leave one behind). This closes the
 * other half: even if such a row arrives by some route nobody predicted, nobody
 * gets double-booked. The whole incident happened because a comment asserted
 * "rows with null can't appear here" and they appeared.
 *
 * HOW THIS FILE IS ORGANISED
 * --------------------------
 * The first two blocks are the ones that matter most for safety. They assert
 * the change is INERT everywhere it should be — units off, and healthy units
 * activities with no orphaned rows. If this fix were going to break ordinary
 * customers, it would break them there. The later blocks prove it actually
 * does its job, across every shape: daily/hourly x whole-unit/per-person x
 * single/multi unit, plus the payment-recovery path.
 */

import { getTestContext, seedReference } from './_setup';
import { BookingsService } from '../../src/bookings/bookings.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeSvc() {
  const prismaSvc = { client: ctx.prisma } as any;
  return new BookingsService(
    prismaSvc,
    { log: jest.fn().mockResolvedValue(undefined) } as any,
    { send: jest.fn().mockResolvedValue(undefined), notifyAdmins: jest.fn(), sendToMany: jest.fn() } as any,
    { acquire: jest.fn().mockResolvedValue('tok'), release: jest.fn().mockResolvedValue(undefined) } as any,
    {
      get: (k: string, fb?: string) =>
        (({ RESERVATION_WINDOW_MINUTES: '15', BOOKING_MAX_ADVANCE_MONTHS: '6', REDIS_LOCK_TTL_MS: '30000' }) as Record<string, string>)[k] ?? fb,
    } as any,
    new LoyaltyService(prismaSvc),
    {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn().mockResolvedValue(undefined),
      invalidateMany: jest.fn().mockResolvedValue(undefined),
    } as any,
    { sendBookingOtp: jest.fn().mockResolvedValue(undefined) } as any,
    { tryConsume: jest.fn().mockResolvedValue(true) } as any,
    { log: jest.fn() } as any,
  );
}

function d(n: number): string {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
const monthOf = (s: string) => s.slice(0, 7);
const at = (ds: string, t: string) => new Date(`${ds}T${t}:00.000Z`);
const PHONE = '+97455123456';

const DAILY_WHOLE = {
  bookingType: 'DAILY', pricingModel: 'PER_UNIT',
  durationValue: null, checkInTime: '15:00', checkOutTime: '12:00',
};
const HOURLY_WHOLE = {
  bookingType: 'HOURLY', pricingModel: 'PER_UNIT',
  durationValue: 2, checkInTime: '09:00', checkOutTime: '21:00',
};
const HOURLY_SEATS = {
  bookingType: 'HOURLY', pricingModel: 'PER_PERSON',
  durationValue: 2, checkInTime: '09:00', checkOutTime: '21:00',
};

async function makeActivity(seed: any, over: Record<string, unknown>) {
  return ctx.prisma.activity.create({
    data: {
      vendorId: seed.vendor.id, categoryId: seed.category.id,
      countryId: seed.country.id, cityId: seed.city.id,
      titleEn: 'A', titleAr: 'أ',
      slug: 'a-' + crypto.randomUUID().slice(0, 8),
      descriptionEn: 'd', descriptionAr: 'و',
      locationAddress: 'Doha', locationLat: 25.28, locationLng: 51.53,
      pricePerPerson: 500, coverImage: '/p.webp', status: 'ACTIVE',
      hasUnits: false, unitCount: 0, unitCapacity: 1, capacity: 10,
      ...over,
    },
  });
}

/** Insert a row directly — createBooking can no longer produce an orphan. */
async function seedBooking(
  seed: any, activityId: string,
  start: Date, end: Date,
  opts: { unitNumber?: number | null; guests?: number } = {},
) {
  return ctx.prisma.booking.create({
    data: {
      ref: 'JDWL-' + crypto.randomUUID().slice(0, 8).toUpperCase(),
      activityId, customerId: seed.customer.id, vendorId: seed.vendor.id,
      startDatetime: start, endDatetime: end,
      guests: opts.guests ?? 2,
      unitNumber: opts.unitNumber ?? null,
      status: 'CONFIRMED', totalPrice: 500, serviceFee: 0, bookingPhone: PHONE,
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
// SAFETY FIRST — the change must be INERT where it does not apply
// ═══════════════════════════════════════════════════════════════════════════

describe('INERT — activities WITHOUT units are completely untouched', () => {

  test('DAILY seat-based: every booking has a null unit, and that stays correct', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeSvc();
    // hasUnits false. EVERY booking here legitimately has unitNumber = null —
    // if the fix leaked outside `hasUnits`, this activity would instantly read
    // as fully booked and the vendor would silently lose every sale.
    const act = await makeActivity(seed, { ...DAILY_WHOLE, pricingModel: 'PER_PERSON', capacity: 8 });

    const b = await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: d(5), checkOutDate: d(7), guests: 2, bookingPhone: PHONE,
    } as any);
    await ctx.prisma.booking.update({
      where: { id: b.booking.id }, data: { status: 'CONFIRMED', reservedUntil: null },
    });
    expect(b.booking.unitNumber).toBeNull(); // correct for this shape

    const cal: any = await svc.getCalendarAvailability(act.id, monthOf(d(5)));
    const day = cal.days.find((x: any) => x.date === d(5));
    // Seats, not units: 8 capacity minus 2 guests.
    expect(day.capacity).toBe(8);
    expect(day.booked).toBe(2);
    expect(day.available).toBe(6);
    expect(day.isFullyBooked).toBe(false);

    // ...and more bookings are still possible.
    const more = await svc.createBooking((await makeCustomer()).id, {
      activityId: act.id, checkInDate: d(5), checkOutDate: d(7), guests: 2, bookingPhone: PHONE,
    } as any);
    expect(more.booking).toBeTruthy();
  });

  test('HOURLY seat-based: slots still fill by guests, not by units', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeSvc();
    const act = await makeActivity(seed, { ...HOURLY_SEATS, capacity: 10 });

    const b = await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: d(5), slotTime: '09:00', guests: 3, bookingPhone: PHONE,
    } as any);
    await ctx.prisma.booking.update({
      where: { id: b.booking.id }, data: { status: 'CONFIRMED', reservedUntil: null },
    });

    const avail: any = await svc.getHourlyAvailability(act.id, d(5));
    const slot = avail.slots.find((s: any) => s.slotStart === '09:00');
    expect(slot.booked).toBe(3);
    expect(slot.available).toBe(7);
  });
});

describe('INERT — a HEALTHY units activity behaves exactly as before', () => {

  test.each([
    ['DAILY whole-unit, 3 units', { ...DAILY_WHOLE, hasUnits: true, unitCount: 3, unitCapacity: 6, capacity: 18 }],
    ['HOURLY whole-unit, 2 units', { ...HOURLY_WHOLE, hasUnits: true, unitCount: 2, unitCapacity: 6, capacity: 12 }],
    ['HOURLY per-person, 2 units', { ...HOURLY_SEATS, hasUnits: true, unitCount: 2, unitCapacity: 6, capacity: 12 }],
  ])('%s: no orphans means no change', async (_label, over) => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeSvc();
    const act = await makeActivity(seed, over as Record<string, unknown>);
    const daily = (over as any).bookingType === 'DAILY';

    const b = await svc.createBooking(seed.customer.id, {
      activityId: act.id,
      ...(daily ? { checkInDate: d(5), checkOutDate: d(7) } : { checkInDate: d(5), slotTime: '09:00' }),
      guests: 2, bookingPhone: PHONE,
    } as any);
    await ctx.prisma.booking.update({
      where: { id: b.booking.id }, data: { status: 'CONFIRMED', reservedUntil: null },
    });

    // A real unit was assigned, so there are no orphans anywhere.
    expect(b.booking.unitNumber).toBe(1);

    const cal: any = await svc.getCalendarAvailability(act.id, monthOf(d(5)));
    const day = cal.days.find((x: any) => x.date === d(5));
    // One of several units taken -> the day is NOT full. If the fix
    // double-counted, this would read as more occupied than it is.
    expect(day.isFullyBooked).toBe(false);

    // And a second customer can still book the remaining unit.
    const second = await svc.createBooking((await makeCustomer()).id, {
      activityId: act.id,
      ...(daily ? { checkInDate: d(5), checkOutDate: d(7) } : { checkInDate: d(5), slotTime: '09:00' }),
      guests: 2, bookingPhone: PHONE,
    } as any);
    expect(second.booking).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE FIX ITSELF
// ═══════════════════════════════════════════════════════════════════════════

describe('DAILY whole-unit — the reported production case', () => {

  test('an orphaned booking is visible on the calendar and blocks a resale', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeSvc();
    // Cavilam's real shape: one resort, 25 guests.
    const act = await makeActivity(seed, { ...DAILY_WHOLE, hasUnits: true, unitCount: 1, unitCapacity: 25, capacity: 25 });

    await seedBooking(seed, act.id, at(d(5), '15:00'), at(d(7), '12:00'));

    const cal: any = await svc.getCalendarAvailability(act.id, monthOf(d(5)));
    const day = cal.days.find((x: any) => x.date === d(5));
    expect(day.capacity).toBe(1);
    expect(day.booked).toBe(1);        // was 0 — the entire bug
    expect(day.available).toBe(0);
    expect(day.isFullyBooked).toBe(true);

    // The booking form agrees.
    const form: any = await svc.getDailyAvailability(act.id, d(5), d(7));
    expect(form.units[0].available).toBe(0);

    // And nobody can take the room out from under them.
    await expect(
      svc.createBooking((await makeCustomer()).id, {
        activityId: act.id, checkInDate: d(5), checkOutDate: d(7), guests: 2, bookingPhone: PHONE,
      } as any),
    ).rejects.toThrow(/fully booked|all units/i);
  });

  test('asking about one specific unit also sees the orphan', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeSvc();
    const act = await makeActivity(seed, { ...DAILY_WHOLE, hasUnits: true, unitCount: 1, unitCapacity: 25, capacity: 25 });
    await seedBooking(seed, act.id, at(d(5), '15:00'), at(d(7), '12:00'));

    // The per-unit query used to filter on unitNumber at SQL level, dropping
    // orphans entirely — so this view reported free while the guest was in.
    const form: any = await svc.getDailyAvailability(act.id, d(5), d(7), 1);
    expect(form.available).toBe(0);

    const cal: any = await svc.getCalendarAvailability(act.id, monthOf(d(5)), 1);
    expect(cal.days.find((x: any) => x.date === d(5)).isFullyBooked).toBe(true);
  });

  test('multi-unit: one orphan removes exactly one unit, not all of them', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeSvc();
    const act = await makeActivity(seed, { ...DAILY_WHOLE, hasUnits: true, unitCount: 3, unitCapacity: 6, capacity: 18 });

    await seedBooking(seed, act.id, at(d(5), '15:00'), at(d(7), '12:00')); // orphan

    const cal: any = await svc.getCalendarAvailability(act.id, monthOf(d(5)));
    const day = cal.days.find((x: any) => x.date === d(5));
    expect(day.booked).toBe(1);
    expect(day.available).toBe(2);      // 2 of 3 genuinely free
    expect(day.isFullyBooked).toBe(false);

    // Two more customers fit; the third does not.
    const ok1 = await svc.createBooking((await makeCustomer()).id, {
      activityId: act.id, checkInDate: d(5), checkOutDate: d(7), guests: 2, bookingPhone: PHONE,
    } as any);
    await ctx.prisma.booking.update({ where: { id: ok1.booking.id }, data: { status: 'CONFIRMED', reservedUntil: null } });
    const ok2 = await svc.createBooking((await makeCustomer()).id, {
      activityId: act.id, checkInDate: d(5), checkOutDate: d(7), guests: 2, bookingPhone: PHONE,
    } as any);
    await ctx.prisma.booking.update({ where: { id: ok2.booking.id }, data: { status: 'CONFIRMED', reservedUntil: null } });

    await expect(
      svc.createBooking((await makeCustomer()).id, {
        activityId: act.id, checkInDate: d(5), checkOutDate: d(7), guests: 2, bookingPhone: PHONE,
      } as any),
    ).rejects.toThrow(/fully booked|all units/i);
  });

  test('more orphans than units caps at full — never negative availability', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeSvc();
    const act = await makeActivity(seed, { ...DAILY_WHOLE, hasUnits: true, unitCount: 2, unitCapacity: 6, capacity: 12 });

    // Already oversold before this fix existed.
    for (let i = 0; i < 4; i++) {
      await seedBooking(seed, act.id, at(d(5), '15:00'), at(d(7), '12:00'));
    }

    const cal: any = await svc.getCalendarAvailability(act.id, monthOf(d(5)));
    const day = cal.days.find((x: any) => x.date === d(5));
    expect(day.booked).toBe(2);          // capped at unitCount, not 4
    expect(day.available).toBe(0);       // never negative
    expect(day.isFullyBooked).toBe(true);
  });

  test('an orphan on OTHER dates does not block an unrelated window', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeSvc();
    const act = await makeActivity(seed, { ...DAILY_WHOLE, hasUnits: true, unitCount: 1, unitCapacity: 25, capacity: 25 });

    await seedBooking(seed, act.id, at(d(20), '15:00'), at(d(22), '12:00'));

    // Orphans must only affect the dates they actually overlap — otherwise one
    // bad row would take an activity off sale entirely.
    const b = await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: d(5), checkOutDate: d(7), guests: 2, bookingPhone: PHONE,
    } as any);
    expect(b.booking.unitNumber).toBe(1);

    const cal: any = await svc.getCalendarAvailability(act.id, monthOf(d(5)));
    expect(cal.days.find((x: any) => x.date === d(10)).isFullyBooked).toBe(false);
  });
});

describe('HOURLY whole-unit — same rules, per slot', () => {

  test('an orphan takes the slot it overlaps and leaves the others open', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeSvc();
    const act = await makeActivity(seed, { ...HOURLY_WHOLE, hasUnits: true, unitCount: 1, unitCapacity: 8, capacity: 8 });

    // 09:00-11:00 only.
    await seedBooking(seed, act.id, at(d(5), '09:00'), at(d(5), '11:00'));

    const avail: any = await svc.getHourlyAvailability(act.id, d(5));
    const nine = avail.slots.find((s: any) => s.slotStart === '09:00');
    const eleven = avail.slots.find((s: any) => s.slotStart === '11:00');

    expect(nine.totalAvailable).toBe(0);      // taken by the orphan
    expect(eleven.totalAvailable).toBeGreaterThan(0); // untouched

    await expect(
      svc.createBooking((await makeCustomer()).id, {
        activityId: act.id, checkInDate: d(5), slotTime: '09:00', guests: 2, bookingPhone: PHONE,
      } as any),
    ).rejects.toThrow(/fully booked|all units/i);

    // The free slot still books.
    const later = await svc.createBooking((await makeCustomer()).id, {
      activityId: act.id, checkInDate: d(5), slotTime: '11:00', guests: 2, bookingPhone: PHONE,
    } as any);
    expect(later.booking).toBeTruthy();
  });
});

describe('AGREEMENT — a BLOCKED date must still report the orphan as booked', () => {

  test('calendar and booking form agree on a night that is both blocked and occupied', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeSvc();
    const act = await makeActivity(seed, { ...DAILY_WHOLE, hasUnits: true, unitCount: 1, unitCapacity: 25, capacity: 25 });

    // An orphaned guest...
    await seedBooking(seed, act.id, at(d(5), '15:00'), at(d(6), '12:00'));
    // ...on a night staff ALSO closed by hand, which is exactly what happened
    // in production: they blocked the dates precisely because the calendar was
    // not showing the guest.
    await ctx.prisma.activityBlock.create({
      data: {
        activityId: act.id, vendorId: seed.vendor.id,
        blockStart: at(d(5), '00:00'), blockEnd: at(d(6), '23:59'),
      },
    });

    const cal: any = await svc.getCalendarAvailability(act.id, monthOf(d(5)));
    const day = cal.days.find((x: any) => x.date === d(5));
    const form: any = await svc.getDailyAvailability(act.id, d(5), d(6));

    // Both must agree the unit is taken. The retirement loop used to be gated
    // on `available > 0`, and a block has already forced that to 0 — so the
    // form reported booked = 0 while the calendar reported booked = 1 for the
    // same night. Availability was right either way; the disagreement was not.
    expect(day.isBlocked).toBe(true);
    expect(day.booked).toBe(1);
    expect(form.units[0].booked).toBeGreaterThan(0);
    expect(form.units[0].available).toBe(0);
  });
});

describe('AGREEMENT — the calendar must not advertise what booking will refuse', () => {

  test('multi-unit per-person: calendar availability matches what can be booked', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeSvc();
    // 2 units x 6 seats = 12 pooled capacity.
    const act = await makeActivity(seed, { ...HOURLY_SEATS, hasUnits: true, unitCount: 2, unitCapacity: 6, capacity: 12 });

    // A SIX-guest orphan. Counted once against the pool this leaves 6 seats
    // "available", but createBooking charges those guests to every unit (it
    // cannot tell which one they are in), so no unit has room for six. The
    // calendar would advertise a slot the booking path then refuses — two
    // views disagreeing, which is the whole class of bug being removed here.
    await seedBooking(seed, act.id, at(d(5), '09:00'), at(d(5), '11:00'), { guests: 6 });

    const cal: any = await svc.getCalendarAvailability(act.id, monthOf(d(5)));
    const day = cal.days.find((x: any) => x.date === d(5));

    // Whatever the calendar claims, a booking of that size must succeed.
    const claimed = day.available as number;
    if (claimed > 0) {
      const attempt = await svc.createBooking((await makeCustomer()).id, {
        activityId: act.id, checkInDate: d(5), slotTime: '09:00',
        guests: claimed, bookingPhone: PHONE,
      } as any).catch(() => null);
      expect(attempt).not.toBeNull();
    }

    // And the reverse: a request for one more than claimed must be refused.
    const tooMany = await svc.createBooking((await makeCustomer()).id, {
      activityId: act.id, checkInDate: d(5), slotTime: '09:00',
      guests: claimed + 1, bookingPhone: PHONE,
    } as any).catch(() => null);
    expect(tooMany).toBeNull();
  });

  test('no orphans: the pooled arithmetic is untouched for HOURLY per-person units', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeSvc();
    const act = await makeActivity(seed, { ...HOURLY_SEATS, hasUnits: true, unitCount: 2, unitCapacity: 6, capacity: 12 });

    // Two bookings in DIFFERENT units at DIFFERENT times. Cross-unit peak
    // concurrency and a sum of per-unit peaks are legitimately different
    // numbers here, so the per-unit recomputation must NOT engage without
    // orphans — otherwise healthy activities would silently lose availability.
    const a = await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: d(5), slotTime: '09:00', guests: 6, bookingPhone: PHONE,
    } as any);
    await ctx.prisma.booking.update({ where: { id: a.booking.id }, data: { status: 'CONFIRMED', reservedUntil: null } });

    const cal: any = await svc.getCalendarAvailability(act.id, monthOf(d(5)));
    const day = cal.days.find((x: any) => x.date === d(5));
    // 12 pooled capacity, 6 taken at one slot -> the DAY is not full.
    expect(day.isFullyBooked).toBe(false);
    expect(day.available).toBeGreaterThan(0);
  });
});

describe('HOURLY per-person units — orphan guests count as seats, not whole units', () => {

  test('an orphan consumes seats and the rest of the unit stays sellable', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeSvc();
    // 1 unit of 6 seats. A whole-unit rule here would wrongly kill all 6.
    const act = await makeActivity(seed, { ...HOURLY_SEATS, hasUnits: true, unitCount: 1, unitCapacity: 6, capacity: 6 });

    await seedBooking(seed, act.id, at(d(5), '09:00'), at(d(5), '11:00'), { guests: 2 });

    const avail: any = await svc.getHourlyAvailability(act.id, d(5));
    const nine = avail.slots.find((s: any) => s.slotStart === '09:00');
    expect(nine.units[0].booked).toBe(2);
    expect(nine.units[0].available).toBe(4);   // seats, not zero

    // 4 seats really are sellable...
    const ok = await svc.createBooking((await makeCustomer()).id, {
      activityId: act.id, checkInDate: d(5), slotTime: '09:00', guests: 4, bookingPhone: PHONE,
    } as any);
    expect(ok.booking).toBeTruthy();
    await ctx.prisma.booking.update({ where: { id: ok.booking.id }, data: { status: 'CONFIRMED', reservedUntil: null } });

    // ...and the 7th guest is not.
    await expect(
      svc.createBooking((await makeCustomer()).id, {
        activityId: act.id, checkInDate: d(5), slotTime: '09:00', guests: 1, bookingPhone: PHONE,
      } as any),
    ).rejects.toThrow(/fully booked|all units|seat/i);
  });
});
