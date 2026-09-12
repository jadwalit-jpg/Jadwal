/**
 * Integration — BOOKING LOGIC INVARIANTS across every activity shape.
 *
 * WHY THIS FILE IS DIFFERENT FROM THE OTHER BOOKING SPECS
 * ------------------------------------------------------
 * The existing specs assert BEHAVIOUR: "given X, the service returns Y". That
 * is necessary but it could not catch the 2026-09-12 defect, because there the
 * calendar and createBooking agreed with each other perfectly — both believed a
 * booked resort was free. Two views agreeing proves consistency, not truth.
 *
 * So this file asserts the INVARIANT instead — the rule the booking system
 * exists to uphold, stated without reference to how it is implemented:
 *
 *     Never may more guests, or more simultaneous bookings, be live against an
 *     activity than its real inventory can serve.
 *
 * That holds whatever the internal representation is. `assertNotOversold()`
 * below counts the bookings that actually exist in the database and compares
 * them to the activity's inventory — it never consults `unitNumber` to decide
 * whether a booking counts, which is exactly the blind spot that let the
 * original bug through. Verified: these invariants FAIL on the pre-fix
 * behaviour and hold after.
 *
 * Keep this file as the outermost guard. If a future refactor of availability,
 * units, capacity, pricing or time handling breaks the promise to customers,
 * something here should go red even if every behavioural test still passes.
 */

import { getTestContext, seedReference } from './_setup';
import {
  BookingsService, activeBookingFilter, maxConcurrentInWindow, rentsWholeUnit, computeSlots,
} from '../../src/bookings/bookings.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeBookingsService() {
  const prismaSvc = { client: ctx.prisma } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  return new BookingsService(
    prismaSvc,
    { log: jest.fn().mockResolvedValue(undefined) } as any,
    { send: jest.fn().mockResolvedValue(undefined), notifyAdmins: jest.fn(), sendToMany: jest.fn() } as any,
    { acquire: jest.fn().mockResolvedValue('tok'), release: jest.fn().mockResolvedValue(undefined) } as any,
    {
      get: (k: string, fb?: string) =>
        (({ RESERVATION_WINDOW_MINUTES: '15', BOOKING_MAX_ADVANCE_YEARS: '2', REDIS_LOCK_TTL_MS: '30000' }) as Record<string, string>)[k] ?? fb,
    } as any,
    loyalty,
    {
      // Always a miss: we are testing the computation, and a cache hit would
      // mask a wrong answer behind a previously-correct one.
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

function d(daysFromNow: number): string {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() + daysFromNow);
  return dt.toISOString().slice(0, 10);
}
const monthOf = (dateStr: string) => dateStr.slice(0, 7);
const PHONE = '+97455123456';

// ─── activity shapes ────────────────────────────────────────────────────────
// One entry per combination that behaves differently in the booking code, so a
// change that only considered one shape gets caught by the others.

interface Shape {
  name: string;
  /** Inventory the activity can truly serve simultaneously. */
  data: Record<string, unknown>;
  /** DAILY = date range; HOURLY = a slot on one day. */
  kind: 'DAILY' | 'HOURLY';
}

const SHAPES: Shape[] = [
  {
    name: 'DAILY whole-unit, 1 unit (resort / chalet)',
    kind: 'DAILY',
    data: { bookingType: 'DAILY', pricingModel: 'PER_UNIT', hasUnits: true, unitCount: 1, unitCapacity: 25, capacity: 25, durationValue: null, checkInTime: '15:00', checkOutTime: '12:00' },
  },
  {
    name: 'DAILY whole-unit, 3 units (multi-cabin site)',
    kind: 'DAILY',
    data: { bookingType: 'DAILY', pricingModel: 'PER_UNIT', hasUnits: true, unitCount: 3, unitCapacity: 6, capacity: 18, durationValue: null, checkInTime: '15:00', checkOutTime: '12:00' },
  },
  {
    name: 'DAILY seat-based, no units (capacity 8)',
    kind: 'DAILY',
    data: { bookingType: 'DAILY', pricingModel: 'PER_PERSON', hasUnits: false, unitCount: 0, unitCapacity: 1, capacity: 8, durationValue: null, checkInTime: '15:00', checkOutTime: '12:00' },
  },
  {
    name: 'HOURLY whole-unit, 1 unit (yacht / speedboat)',
    kind: 'HOURLY',
    data: { bookingType: 'HOURLY', pricingModel: 'PER_UNIT', hasUnits: true, unitCount: 1, unitCapacity: 8, capacity: 8, durationValue: 2, checkInTime: '09:00', checkOutTime: '21:00' },
  },
  {
    name: 'HOURLY per-person with units (safari, 2 units x 6)',
    kind: 'HOURLY',
    data: { bookingType: 'HOURLY', pricingModel: 'PER_PERSON', hasUnits: true, unitCount: 2, unitCapacity: 6, capacity: 12, durationValue: 2, checkInTime: '09:00', checkOutTime: '21:00' },
  },
  {
    name: 'HOURLY seat-based, no units (capacity 10)',
    kind: 'HOURLY',
    data: { bookingType: 'HOURLY', pricingModel: 'PER_PERSON', hasUnits: false, unitCount: 0, unitCapacity: 1, capacity: 10, durationValue: 2, checkInTime: '09:00', checkOutTime: '21:00' },
  },
];

async function makeActivity(seed: any, over: Record<string, unknown> = {}) {
  return ctx.prisma.activity.create({
    data: {
      vendorId: seed.vendor.id, categoryId: seed.category.id,
      countryId: seed.country.id, cityId: seed.city.id,
      titleEn: 'X', titleAr: 'س',
      slug: 'x-' + crypto.randomUUID().slice(0, 8),
      descriptionEn: 'd', descriptionAr: 'و',
      locationAddress: 'Doha', locationLat: 25.28, locationLng: 51.53,
      pricePerPerson: 500,
      coverImage: '/p.webp', status: 'ACTIVE',
      ...over,
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

/**
 * A refusal we are deliberately testing for: the system declining a booking
 * because the inventory is genuinely gone.
 *
 * Anything else — a bad DTO, a programming error, an unexpected exception — must
 * NOT be silently reported as "the system refused". A blanket `catch { return
 * null }` here made every HOURLY booking look like a capacity refusal when the
 * real cause was this helper sending the wrong field names, which would have
 * turned the whole HOURLY half of this file into tests that prove nothing.
 * Enumerate what counts as a refusal, rethrow the rest.
 */
function isCapacityRefusal(err: unknown): boolean {
  const msg =
    typeof err === 'object' && err !== null
      ? JSON.stringify((err as { response?: unknown; message?: unknown }).response ?? (err as Error).message ?? '')
      : String(err);
  return /fully booked|all units|CAPACITY_FULL|seats? available|not available|blocked/i.test(msg);
}

/** Book however this shape is booked. null = the system refused for capacity. */
async function tryBook(
  svc: BookingsService, customerId: string, act: any, shape: Shape,
  opts: { day?: number; guests?: number; nights?: number; slot?: string } = {},
) {
  const guests = opts.guests ?? 1;
  const day = opts.day ?? 5;
  try {
    if (shape.kind === 'DAILY') {
      const r = await svc.createBooking(customerId, {
        activityId: act.id, checkInDate: d(day), checkOutDate: d(day + (opts.nights ?? 2)),
        guests, bookingPhone: PHONE,
      } as any);
      return r.booking;
    }
    // HOURLY uses checkInDate + slotTime (NOT bookingDate/startTime — that
    // guess cost a whole test run).
    const r = await svc.createBooking(customerId, {
      activityId: act.id, checkInDate: d(day), slotTime: opts.slot ?? '09:00',
      guests, bookingPhone: PHONE,
    } as any);
    return r.booking;
  } catch (err) {
    if (isCapacityRefusal(err)) return null;
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// THE MASTER INVARIANT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Assert the activity is not oversold, reading the bookings that actually
 * exist rather than trusting any availability view.
 *
 * Deliberately does NOT filter or group by `unitNumber` when deciding whether a
 * booking counts — a booking that exists occupies inventory whether or not it
 * carries a unit. That is precisely the assumption whose absence caused the
 * original defect, so it is the assumption this function refuses to make.
 */
async function assertNotOversold(activityId: string) {
  const act = await ctx.prisma.activity.findUnique({
    where: { id: activityId },
    select: { hasUnits: true, unitCount: true, unitCapacity: true, capacity: true, bookingType: true, pricingModel: true },
  });
  const live = await ctx.prisma.booking.findMany({
    where: { activityId, ...activeBookingFilter(new Date()) },
    select: { id: true, startDatetime: true, endDatetime: true, guests: true, unitNumber: true },
  });
  if (live.length === 0) return;

  const window = {
    start: new Date(Math.min(...live.map((b) => b.startDatetime.getTime()))),
    end: new Date(Math.max(...live.map((b) => b.endDatetime.getTime()))),
  };

  if (rentsWholeUnit(act!)) {
    // Each live booking owns one whole unit for its span, so the number of
    // simultaneously-live bookings can never exceed the unit count. Counting
    // each booking as "1" is what makes this blind to unitNumber.
    const asUnits = live.map((b) => ({ ...b, guests: 1 }));
    const peakBookings = maxConcurrentInWindow(asUnits, window.start, window.end);
    expect(peakBookings).toBeLessThanOrEqual(act!.unitCount);

    // And no two overlapping bookings may claim the SAME unit.
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        if (a.unitNumber == null || b.unitNumber == null) continue;
        if (a.unitNumber !== b.unitNumber) continue;
        const clash = a.startDatetime < b.endDatetime && a.endDatetime > b.startDatetime;
        expect(clash).toBe(false);
      }
    }
  } else {
    // Seat-based: peak concurrent guests must fit the capacity.
    const cap = act!.hasUnits ? act!.unitCount * act!.unitCapacity : act!.capacity;
    if (cap != null) {
      expect(maxConcurrentInWindow(live, window.start, window.end)).toBeLessThanOrEqual(cap);
    }
  }
}

describe('INVARIANT — an activity can never be oversold, whatever its shape', () => {

  for (const shape of SHAPES) {
    test(`${shape.name}: hammering it with bookings never oversells`, async () => {
      const seed = await seedReference(ctx.prisma);
      const svc = makeBookingsService();
      const act = await makeActivity(seed, shape.data);

      // Far more attempts than the inventory can serve, all on the same window.
      let accepted = 0;
      for (let i = 0; i < 8; i++) {
        const cust = i === 0 ? seed.customer.id : (await makeCustomer()).id;
        const b = await tryBook(svc, cust, act, shape, { guests: 2 });
        if (b) {
          accepted++;
          await ctx.prisma.booking.update({
            where: { id: b.id }, data: { status: 'CONFIRMED', reservedUntil: null },
          });
        }
        // Checked after EVERY accept, so the first overselling accept is the
        // one that fails — not some later aggregate.
        await assertNotOversold(act.id);
      }

      // Sanity: the shape must accept at least one booking, otherwise the test
      // would "pass" by never booking anything.
      expect(accepted).toBeGreaterThan(0);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// THE THREE VIEWS MUST AGREE WITH EACH OTHER
// ═══════════════════════════════════════════════════════════════════════════

describe('CONSISTENCY — calendar, booking form and createBooking tell one story', () => {

  for (const shape of SHAPES) {
    test(`${shape.name}: a day the calendar calls full cannot be booked`, async () => {
      const seed = await seedReference(ctx.prisma);
      const svc = makeBookingsService();
      const act = await makeActivity(seed, shape.data);

      // Fill it up.
      for (let i = 0; i < 8; i++) {
        const cust = i === 0 ? seed.customer.id : (await makeCustomer()).id;
        const b = await tryBook(svc, cust, act, shape, { guests: 2 });
        if (b) {
          await ctx.prisma.booking.update({
            where: { id: b.id }, data: { status: 'CONFIRMED', reservedUntil: null },
          });
        }
      }

      const cal: any = await svc.getCalendarAvailability(act.id, monthOf(d(5)));
      const day = cal.days.find((x: any) => x.date === d(5));
      expect(day).toBeDefined();

      const another = await makeCustomer();
      const extra = await tryBook(svc, another.id, act, shape, { guests: 2 });

      if (day.isFullyBooked) {
        // The calendar promised no room — the booking path must honour that.
        expect(extra).toBeNull();
      }
      // Whatever happened, inventory must still be sound.
      await assertNotOversold(act.id);
    });
  }

  test('DAILY: the form and the calendar report the same occupancy', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const shape = SHAPES[0];
    const act = await makeActivity(seed, shape.data);

    const b = await tryBook(svc, seed.customer.id, act, shape, { guests: 2 });
    expect(b).not.toBeNull();
    await ctx.prisma.booking.update({
      where: { id: b!.id }, data: { status: 'CONFIRMED', reservedUntil: null },
    });

    const cal: any = await svc.getCalendarAvailability(act.id, monthOf(d(5)));
    const day = cal.days.find((x: any) => x.date === d(5));
    const form: any = await svc.getDailyAvailability(act.id, d(5), d(7));

    const formHasRoom = form.units.some((u: any) => u.available > 0);
    // One unit, one confirmed stay: both views must say there is no room.
    expect(day.isFullyBooked).toBe(true);
    expect(formHasRoom).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TIME HANDLING
// ═══════════════════════════════════════════════════════════════════════════

describe('TIME — boundaries that have bitten this codebase before', () => {

  test('DAILY: check-out then check-in the same day is NOT a conflict', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeActivity(seed, SHAPES[0].data);

    const first = await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: d(5), checkOutDate: d(7), guests: 2, bookingPhone: PHONE,
    } as any);
    await ctx.prisma.booking.update({
      where: { id: first.booking.id }, data: { status: 'CONFIRMED', reservedUntil: null },
    });

    // Leaves d(7) 12:00, next arrives d(7) 15:00 — a real, sellable night.
    const second = await svc.createBooking((await makeCustomer()).id, {
      activityId: act.id, checkInDate: d(7), checkOutDate: d(9), guests: 2, bookingPhone: PHONE,
    } as any);
    expect(second.booking).toBeTruthy();
    await assertNotOversold(act.id);
  });

  test('DAILY: a stay spanning a month boundary is counted in BOTH months', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeActivity(seed, SHAPES[0].data);

    // Walk forward to the 29th of some month so the stay crosses into the next.
    let day = 5;
    for (let i = 0; i < 40; i++) {
      if (new Date(`${d(day)}T00:00:00Z`).getUTCDate() === 28) break;
      day++;
    }
    const start = d(day);          // the 28th
    const end = d(day + 5);        // into the following month

    const b = await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: start, checkOutDate: end, guests: 2, bookingPhone: PHONE,
    } as any);
    await ctx.prisma.booking.update({
      where: { id: b.booking.id }, data: { status: 'CONFIRMED', reservedUntil: null },
    });

    const firstMonth: any = await svc.getCalendarAvailability(act.id, monthOf(start));
    const secondMonth: any = await svc.getCalendarAvailability(act.id, monthOf(end));

    // The night of the 28th is occupied...
    expect(firstMonth.days.find((x: any) => x.date === start).isFullyBooked).toBe(true);
    // ...and so is a night that falls in the NEXT month's calendar. A month
    // query that only looked at bookings starting inside it would miss this.
    const nextMonthNight = secondMonth.days.find((x: any) => x.date === d(day + 2))
      ?? secondMonth.days.find((x: any) => x.date === d(day + 3));
    if (nextMonthNight) expect(nextMonthNight.isFullyBooked).toBe(true);
  });

  test('past dates are never offered as bookable', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeActivity(seed, SHAPES[0].data);

    const cal: any = await svc.getCalendarAvailability(act.id, monthOf(d(0)));
    const todayStr = d(0);
    for (const day of cal.days) {
      if (day.date < todayStr) {
        expect(day.isPast).toBe(true);
      }
    }
  });

  test('HOURLY: slots are generated inside the operating window only', async () => {
    const slots = computeSlots('09:00', '21:00', 2);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]).toBe('09:00');
    // A 2h activity closing at 21:00 must not start a slot at 20:00.
    for (const s of slots) {
      const [h, m] = s.split(':').map(Number);
      expect(h * 60 + m + 2 * 60).toBeLessThanOrEqual(21 * 60);
    }
  });

  test('HOURLY: a booked slot does not block a non-overlapping later slot', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const shape = SHAPES[3]; // 1-unit yacht, 2h slots
    const act = await makeActivity(seed, shape.data);

    const a = await tryBook(svc, seed.customer.id, act, shape, { slot: '09:00' });
    expect(a).not.toBeNull();
    await ctx.prisma.booking.update({
      where: { id: a!.id }, data: { status: 'CONFIRMED', reservedUntil: null },
    });

    // 11:00 starts exactly when 09:00–11:00 ends → must be allowed.
    const b = await tryBook(svc, (await makeCustomer()).id, act, shape, { slot: '11:00' });
    expect(b).not.toBeNull();
    await assertNotOversold(act.id);
  });

  test('HOURLY: the same slot cannot be sold twice on a 1-unit activity', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const shape = SHAPES[3];
    const act = await makeActivity(seed, shape.data);

    const a = await tryBook(svc, seed.customer.id, act, shape, { slot: '09:00' });
    await ctx.prisma.booking.update({
      where: { id: a!.id }, data: { status: 'CONFIRMED', reservedUntil: null },
    });
    const b = await tryBook(svc, (await makeCustomer()).id, act, shape, { slot: '09:00' });

    expect(b).toBeNull();
    await assertNotOversold(act.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// STATUS TRANSITIONS RELEASE OR HOLD INVENTORY
// ═══════════════════════════════════════════════════════════════════════════

describe('STATUS — what holds inventory and what releases it', () => {

  test('CANCELLED releases the unit for someone else', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const shape = SHAPES[0];
    const act = await makeActivity(seed, shape.data);

    const a = await tryBook(svc, seed.customer.id, act, shape, { guests: 2 });
    await ctx.prisma.booking.update({
      where: { id: a!.id }, data: { status: 'CONFIRMED', reservedUntil: null },
    });
    expect(await tryBook(svc, (await makeCustomer()).id, act, shape, { guests: 2 })).toBeNull();

    await ctx.prisma.booking.update({ where: { id: a!.id }, data: { status: 'CANCELLED' } });

    const afterCancel = await tryBook(svc, (await makeCustomer()).id, act, shape, { guests: 2 });
    expect(afterCancel).not.toBeNull();
    await assertNotOversold(act.id);
  });

  test('an EXPIRED pending hold releases the unit', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const shape = SHAPES[0];
    const act = await makeActivity(seed, shape.data);

    const a = await tryBook(svc, seed.customer.id, act, shape, { guests: 2 });
    // Still PENDING but the reservation window has lapsed.
    await ctx.prisma.booking.update({
      where: { id: a!.id },
      data: { status: 'PENDING', reservedUntil: new Date(Date.now() - 60_000) },
    });

    const after = await tryBook(svc, (await makeCustomer()).id, act, shape, { guests: 2 });
    expect(after).not.toBeNull();
  });

  test('a LIVE pending hold still blocks the unit', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const shape = SHAPES[0];
    const act = await makeActivity(seed, shape.data);

    const a = await tryBook(svc, seed.customer.id, act, shape, { guests: 2 });
    await ctx.prisma.booking.update({
      where: { id: a!.id },
      data: { status: 'PENDING', reservedUntil: new Date(Date.now() + 10 * 60_000) },
    });

    // An unpaid but un-expired hold must not be sellable out from under them.
    expect(await tryBook(svc, (await makeCustomer()).id, act, shape, { guests: 2 })).toBeNull();
    await assertNotOversold(act.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CAPACITY ARITHMETIC
// ═══════════════════════════════════════════════════════════════════════════

describe('CAPACITY — seat maths never exceeds the limit', () => {

  test('DAILY seat-based: guests cannot exceed capacity across bookings', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const shape = SHAPES[2]; // capacity 8, no units
    const act = await makeActivity(seed, shape.data);

    let total = 0;
    for (let i = 0; i < 6; i++) {
      const cust = i === 0 ? seed.customer.id : (await makeCustomer()).id;
      const b = await tryBook(svc, cust, act, shape, { guests: 3 });
      if (b) {
        total += 3;
        await ctx.prisma.booking.update({
          where: { id: b.id }, data: { status: 'CONFIRMED', reservedUntil: null },
        });
      }
    }
    // 3 + 3 = 6 fits; a third would make 9 > 8.
    expect(total).toBeLessThanOrEqual(8);
    await assertNotOversold(act.id);
  });

  test('a single booking larger than capacity is refused outright', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const shape = SHAPES[2]; // capacity 8
    const act = await makeActivity(seed, shape.data);

    expect(await tryBook(svc, seed.customer.id, act, shape, { guests: 99 })).toBeNull();
  });

  test('whole-unit: one guest still consumes the entire unit', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const shape = SHAPES[0]; // 1 unit, unitCapacity 25
    const act = await makeActivity(seed, shape.data);

    const a = await tryBook(svc, seed.customer.id, act, shape, { guests: 1 });
    await ctx.prisma.booking.update({
      where: { id: a!.id }, data: { status: 'CONFIRMED', reservedUntil: null },
    });

    // 24 "seats" notionally spare, but the resort is taken.
    expect(await tryBook(svc, (await makeCustomer()).id, act, shape, { guests: 1 })).toBeNull();
  });

  test('multi-unit whole-unit: exactly unitCount simultaneous stays, no more', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const shape = SHAPES[1]; // 3 units
    const act = await makeActivity(seed, shape.data);

    let accepted = 0;
    for (let i = 0; i < 5; i++) {
      const cust = i === 0 ? seed.customer.id : (await makeCustomer()).id;
      const b = await tryBook(svc, cust, act, shape, { guests: 2 });
      if (b) {
        accepted++;
        await ctx.prisma.booking.update({
          where: { id: b.id }, data: { status: 'CONFIRMED', reservedUntil: null },
        });
      }
    }
    expect(accepted).toBe(3);
    await assertNotOversold(act.id);
  });
});
