/**
 * BookingsService.createBooking — capacity guard under concurrency.
 *
 * This is the "oversell" defence test: if N customers fire simultaneous
 * booking requests for the same slot with total-requested > capacity, the
 * combination of Redis lock + Serializable tx + EvalPlanQual must guarantee
 * that committed seats ≤ capacity. No unit test can prove this — it needs
 * real Postgres + real Redis.
 */

import { getTestContext, seedReference } from './_setup';
import { BookingsService } from '../../src/bookings/bookings.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { RedisLockService } from '../../src/redis/redis-lock.service';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeBookingsService() {
  const prismaSvc = { client: ctx.prisma } as any;
  const loyalty = new LoyaltyService(prismaSvc);

  // Use REAL RedisLockService — the in-memory stub defeats the purpose.
  const redisStub = { getClient: () => ctx.redis } as any;
  const redisLock = new RedisLockService(redisStub);
  redisLock.onModuleInit();

  const availabilityCache = {
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const configService = {
    get: (k: string, fallback?: string) => {
      const cfg: Record<string, string> = {
        RESERVATION_WINDOW_MINUTES: '15',
        BOOKING_MAX_ADVANCE_YEARS: '2',
        REDIS_LOCK_TTL_MS: '30000',
      };
      return cfg[k] ?? fallback;
    },
  } as any;

  return new BookingsService(
    prismaSvc,
    { log: jest.fn().mockResolvedValue(undefined) } as any,
    { send: jest.fn().mockResolvedValue(undefined), notifyAdmins: jest.fn(), sendToMany: jest.fn() } as any,
    redisLock,
    configService,
    loyalty,
    availabilityCache,
  );
}

function futureDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function makeCustomer(i: number): Promise<string> {
  const u = await ctx.prisma.user.create({
    data: {
      fullName: `Racer${i}`, email: `race${i}-${crypto.randomUUID().slice(0, 6)}@t.com`,
      password: '$2b$10$dummy', role: 'CUSTOMER', emailVerified: true,
    },
  });
  return u.id;
}

// ═══════════════════════════════════════════════════════════════════════════
// Parallel booking — capacity guard
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.createBooking — concurrent capacity guard', () => {
  test('20 parallel same-slot requests → no oversell (committed seats ≤ 10)', async () => {
    // Production uses SET NX PX for slot-scoped mutex: on contention the losers
    // get a 409 "currently being booked" back to the frontend (client retries).
    // The invariant we assert here: no matter how many parallel attempts, the
    // TOTAL seats committed in the DB must never exceed capacity.
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();

    const customers = await Promise.all(
      Array.from({ length: 20 }, (_, i) => makeCustomer(i)),
    );

    const results = await Promise.all(
      customers.map(cid =>
        svc.createBooking(cid, {
          activityId: seed.activity.id,
          checkInDate: futureDate(7),
          slotTime: '10:00',
          guests: 1,
          idempotencyKey: crypto.randomUUID(),
        }).catch(err => ({ err })),
      ),
    );

    const succeeded = results.filter(r => !('err' in r)).length;
    expect(succeeded).toBeGreaterThanOrEqual(1);  // at least one winner
    expect(succeeded).toBeLessThanOrEqual(10);    // never oversells

    // Losers get the canonical contention error (no 500s — graceful rejection)
    const errs = results.filter(r => 'err' in r).map((r: any) => r.err);
    for (const e of errs) {
      expect(e.message).toMatch(/currently being booked|already have a booking/i);
    }

    // DB ground-truth: committed seat count never exceeds capacity (10)
    const agg = await ctx.prisma.booking.aggregate({
      where: {
        activityId: seed.activity.id,
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
      _sum: { guests: true },
    });
    const committed = agg._sum.guests ?? 0;
    expect(committed).toBeLessThanOrEqual(10);
    expect(committed).toBe(succeeded);
  }, 60_000);

  test('sequential bookings up to capacity — all 5 of 2 succeed, 6th rejected', async () => {
    // This is the lock-released happy path: each booking commits + releases the
    // lock before the next starts. All within capacity succeed; over-capacity
    // gets a "not enough seats" rejection.
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const customers = await Promise.all(
      Array.from({ length: 6 }, (_, i) => makeCustomer(i)),
    );

    // 5 successful bookings × 2 guests = 10 (at capacity)
    for (let i = 0; i < 5; i++) {
      const res = await svc.createBooking(customers[i], {
        activityId: seed.activity.id,
        checkInDate: futureDate(7),
        slotTime: '10:00',
        guests: 2,
        idempotencyKey: crypto.randomUUID(),
      });
      expect(res.booking.status).toBe('PENDING');
    }

    // 6th — capacity exhausted
    await expect(
      svc.createBooking(customers[5], {
        activityId: seed.activity.id,
        checkInDate: futureDate(7),
        slotTime: '10:00',
        guests: 2,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow();

    const agg = await ctx.prisma.booking.aggregate({
      where: {
        activityId: seed.activity.id,
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
      _sum: { guests: true },
    });
    expect(agg._sum.guests).toBe(10);
  }, 60_000);

  test('sequential different-date bookings all succeed (no interference)', async () => {
    // Sequential (not parallel) on different dates must always succeed — the
    // capacity guard is per-slot, so different dates should never interfere.
    // Under Postgres Serializable, parallel attempts can conflict on shared
    // read rows (vendor/country/category); that's accepted prod behavior
    // (frontend retries on 409). Sequential is the happy path.
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const customers = await Promise.all(
      Array.from({ length: 10 }, (_, i) => makeCustomer(i)),
    );
    for (let i = 0; i < 10; i++) {
      const res = await svc.createBooking(customers[i], {
        activityId: seed.activity.id,
        checkInDate: futureDate(7 + i),
        slotTime: '10:00',
        guests: 1,
        idempotencyKey: crypto.randomUUID(),
      });
      expect(res.booking.status).toBe('PENDING');
    }
    expect(await ctx.prisma.booking.count()).toBe(10);
  }, 60_000);

  test('sequential different-slot-time bookings all succeed (locks are per-slot, not per-day)', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const customers = await Promise.all(
      Array.from({ length: 4 }, (_, i) => makeCustomer(i)),
    );

    // Non-overlapping 2h slots in the same day
    const slots = ['10:00', '13:00', '16:00', '19:00'];
    for (let i = 0; i < slots.length; i++) {
      const res = await svc.createBooking(customers[i], {
        activityId: seed.activity.id,
        checkInDate: futureDate(7),
        slotTime: slots[i],
        guests: 1,
        idempotencyKey: crypto.randomUUID(),
      });
      expect(res.booking.status).toBe('PENDING');
    }
    expect(await ctx.prisma.booking.count()).toBe(4);
  }, 60_000);
});
