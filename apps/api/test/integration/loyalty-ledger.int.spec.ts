/**
 * LoyaltyService integration — real Postgres, real ledger writes.
 *
 * Proves the invariants that only a real DB can verify:
 *   - Double-entry: sum(delta) == user.loyaltyPoints always
 *   - Atomic redeem under concurrent race (conditional updateMany guards
 *     TOCTOU)
 *   - Clamp-at-zero under race (admin adjust can't drive balance negative)
 *   - Ledger row created in the same transaction as the balance update
 *     (no orphaned balance/ledger divergence)
 */

import { getTestContext, seedReference } from './_setup';
import { LoyaltyService } from '../../src/common/services/loyalty.service';

const ctx = getTestContext();

// The LoyaltyService constructor wants a PrismaService — but it only uses the
// `tx` that's passed to each public method. We can give it a trivial shim.
const loyalty = new LoyaltyService({ client: null } as any);

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

/**
 * Create a customer with a starting loyaltyPoints balance.
 *
 * Also writes a matching `ADMIN_ADJUST` genesis ledger row so the invariant
 * `user.loyaltyPoints == sum(ledger.delta)` holds universally — not just for
 * users that started at zero.
 */
async function mkCustomer(startingPoints: number): Promise<string> {
  const user = await ctx.prisma.user.create({
    data: {
      fullName: 'Loyalty User', email: `loyalty-${Math.random()}@t.com`,
      password: '$2b$10$dummy.hash.for.tests.never.used.in.auth',
      role: 'CUSTOMER', emailVerified: true, loyaltyPoints: startingPoints,
    },
  });
  if (startingPoints !== 0) {
    await ctx.prisma.loyaltyLedger.create({
      data: {
        userId: user.id,
        delta: startingPoints,
        balanceAfter: startingPoints,
        source: 'ADMIN_ADJUST',
        bookingId: null,
        actorType: 'SYSTEM',
        actorId: null,
        reason: 'genesis: test seed',
      },
    });
  }
  return user.id;
}

async function balanceOf(userId: string): Promise<number> {
  const u = await ctx.prisma.user.findUniqueOrThrow({
    where: { id: userId }, select: { loyaltyPoints: true },
  });
  return u.loyaltyPoints;
}

async function ledgerSum(userId: string): Promise<number> {
  const agg = await ctx.prisma.loyaltyLedger.aggregate({
    where: { userId }, _sum: { delta: true },
  });
  return Number(agg._sum.delta ?? 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// Double-entry invariant: sum(delta) == balance
// ═══════════════════════════════════════════════════════════════════════════

describe('LoyaltyService — double-entry invariant', () => {
  test('earn → redeem → refund sequence: sum(delta) always equals balance', async () => {
    const seed = await seedReference(ctx.prisma);
    const userId = await mkCustomer(0);

    // A booking row is required for FK on LoyaltyLedger.bookingId (not strictly
    // required by schema but realistic).
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-LEDG1', currencyCode: 'QAR',
        activityId: seed.activity.id, vendorId: seed.vendor.id, customerId: userId,
        guests: 1, bookingPhone: '+97455123456', totalPrice: 100, serviceFee: 5,
        status: 'COMPLETED',
        startDatetime: new Date('2030-01-01T10:00:00Z'),
        endDatetime:   new Date('2030-01-01T12:00:00Z'),
      },
    });

    // 1) Earn 100 points from completing the booking
    await ctx.prisma.$transaction(async (tx) => {
      await loyalty.earn(tx, { userId, amount: 100, bookingId: booking.id, note: 'completed' });
    });
    expect(await balanceOf(userId)).toBe(100);
    expect(await ledgerSum(userId)).toBe(100);

    // 2) Redeem 30 points on a follow-up booking
    await ctx.prisma.$transaction(async (tx) => {
      await loyalty.redeem(tx, { userId, amount: 30, bookingId: booking.id, note: 'redeemed' });
    });
    expect(await balanceOf(userId)).toBe(70);
    expect(await ledgerSum(userId)).toBe(70);

    // 3) Cancel the follow-up → refund the 30 back
    await ctx.prisma.$transaction(async (tx) => {
      await loyalty.refund(tx, {
        userId, amount: 30, bookingId: booking.id,
        source: 'CANCEL_REFUND_PAID', actorType: 'CUSTOMER', note: 'cancelled',
      });
    });
    expect(await balanceOf(userId)).toBe(100);
    expect(await ledgerSum(userId)).toBe(100);

    // 4) Admin adjusts -40 (promo correction)
    await ctx.prisma.$transaction(async (tx) => {
      await loyalty.adjust(tx, {
        userId, delta: -40, actorType: 'ADMIN', actorId: seed.vendorUser.id,
        reason: 'promo reversal',
      });
    });
    expect(await balanceOf(userId)).toBe(60);
    expect(await ledgerSum(userId)).toBe(60);
  });

  test('every mutation writes exactly one ledger row with balanceAfter snapshot', async () => {
    const seed = await seedReference(ctx.prisma);
    const userId = await mkCustomer(500);
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-LEDG2', currencyCode: 'QAR',
        activityId: seed.activity.id, vendorId: seed.vendor.id, customerId: userId,
        guests: 1, bookingPhone: '+97455123456', totalPrice: 100, serviceFee: 5, status: 'CONFIRMED',
        startDatetime: new Date('2030-01-02T10:00:00Z'),
        endDatetime:   new Date('2030-01-02T12:00:00Z'),
      },
    });

    // Two redeems on DIFFERENT bookings. The loyalty_ledger (bookingId, source)
    // unique index (migration 20260621000000) forbids two BOOKING_REDEEM rows for
    // the same booking — which matches real code (a booking is redeemed exactly
    // once at creation). bookingId is a correlation string, not an FK, so a
    // synthetic second id is valid here; the assertions are per-user balance and
    // don't depend on which booking.
    await ctx.prisma.$transaction(async (tx) => {
      await loyalty.redeem(tx, { userId, amount: 100, bookingId: booking.id, note: 'one' });
    });
    await ctx.prisma.$transaction(async (tx) => {
      await loyalty.redeem(tx, { userId, amount: 50, bookingId: `${booking.id}-2`, note: 'two' });
    });

    // Skip genesis seed row; inspect just the two redeems
    const rows = await ctx.prisma.loyaltyLedger.findMany({
      where: { userId, source: 'BOOKING_REDEEM' },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].delta).toBe(-100);
    expect(rows[0].balanceAfter).toBe(400);
    expect(rows[1].delta).toBe(-50);
    expect(rows[1].balanceAfter).toBe(350); // Snapshot matches actual post-write balance
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Atomic redeem under concurrent race
// ═══════════════════════════════════════════════════════════════════════════

describe('LoyaltyService.redeem — TOCTOU-safe under parallel race', () => {
  test('100 points + two parallel 60-point redeems → exactly ONE succeeds', async () => {
    const seed = await seedReference(ctx.prisma);
    const userId = await mkCustomer(100);
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-RACE-1', currencyCode: 'QAR',
        activityId: seed.activity.id, vendorId: seed.vendor.id, customerId: userId,
        guests: 1, bookingPhone: '+97455123456', totalPrice: 60, serviceFee: 5, status: 'CONFIRMED',
        startDatetime: new Date('2030-01-03T10:00:00Z'),
        endDatetime:   new Date('2030-01-03T12:00:00Z'),
      },
    });

    // Fire two parallel redeems for 60 each. Balance is 100 — only ONE can win.
    const results = await Promise.allSettled([
      ctx.prisma.$transaction(async (tx) => {
        return loyalty.redeem(tx, { userId, amount: 60, bookingId: booking.id, note: 'race1' });
      }),
      ctx.prisma.$transaction(async (tx) => {
        return loyalty.redeem(tx, { userId, amount: 60, bookingId: booking.id, note: 'race2' });
      }),
    ]);

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed    = results.filter(r => r.status === 'rejected').length;

    expect(succeeded).toBe(1);
    expect(failed).toBe(1);

    // Invariant: sum(delta) == balance (holds because mkCustomer seeded a
    // genesis ledger row for the starting 100)
    expect(await balanceOf(userId)).toBe(40);
    expect(await ledgerSum(userId)).toBe(40);

    // Ledger rows: 1 genesis + 1 successful redeem = 2 (loser wrote nothing)
    const rows = await ctx.prisma.loyaltyLedger.findMany({
      where: { userId, source: 'BOOKING_REDEEM' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].delta).toBe(-60);
  });

  test('10 parallel 15-point redeems on 100-point balance → at most 6 succeed (100/15 floor)', async () => {
    const seed = await seedReference(ctx.prisma);
    const userId = await mkCustomer(100);
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-RACE-2', currencyCode: 'QAR',
        activityId: seed.activity.id, vendorId: seed.vendor.id, customerId: userId,
        guests: 1, bookingPhone: '+97455123456', totalPrice: 60, serviceFee: 5, status: 'CONFIRMED',
        startDatetime: new Date('2030-01-04T10:00:00Z'),
        endDatetime:   new Date('2030-01-04T12:00:00Z'),
      },
    });

    // Distinct bookingId per redeem: this test isolates the BALANCE TOCTOU guard
    // (atomic decrement → at most 6 by balance). A shared bookingId would instead
    // be capped at 1 by the loyalty_ledger (bookingId, source) unique index
    // (migration 20260621000000), masking the balance race we're testing here.
    // bookingId is a correlation string (not an FK), so synthetic ids are valid.
    const runs = Array.from({ length: 10 }, (_, i) =>
      ctx.prisma.$transaction(async (tx) => {
        return loyalty.redeem(tx, { userId, amount: 15, bookingId: `${booking.id}-${i}`, note: `parallel-${i}` });
      }).catch(e => e),
    );
    const results = await Promise.all(runs);
    const succeeded = results.filter((r: unknown) => r && typeof r === 'object' && 'balanceAfter' in (r as any)).length;

    // Theoretical max: floor(100/15) = 6
    expect(succeeded).toBeLessThanOrEqual(6);
    expect(succeeded).toBeGreaterThanOrEqual(1);

    // Invariants:
    // - final balance = 100 - (15 × succeeded)
    // - ledger sum matches balance (holds because of genesis seed row)
    // - BOOKING_REDEEM row count == succeeded (losers wrote nothing)
    const finalBalance = await balanceOf(userId);
    expect(finalBalance).toBe(100 - 15 * succeeded);
    expect(await ledgerSum(userId)).toBe(finalBalance);
    expect(await ctx.prisma.loyaltyLedger.count({
      where: { userId, source: 'BOOKING_REDEEM' },
    })).toBe(succeeded);
    // Never goes negative
    expect(finalBalance).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// adjust — clamp-at-zero under race
// ═══════════════════════════════════════════════════════════════════════════

describe('LoyaltyService.adjust — clamp never drives balance negative', () => {
  test('admin tries to deduct 500 from a 100-balance user → applied delta = -100, balance = 0', async () => {
    const seed = await seedReference(ctx.prisma);
    const userId = await mkCustomer(100);

    const result = await ctx.prisma.$transaction(async (tx) => {
      return loyalty.adjust(tx, {
        userId, delta: -500, actorType: 'ADMIN', actorId: seed.vendorUser.id,
        reason: 'big correction',
      });
    });

    expect(result.appliedDelta).toBe(-100);
    expect(result.balanceAfter).toBe(0);
    expect(await balanceOf(userId)).toBe(0);
    // Ledger sum = 100 (genesis) + (-100) (this adjust) = 0 ✓ (matches balance)
    expect(await ledgerSum(userId)).toBe(0);

    // Ledger row records the CLAMPED delta (what actually happened), not the
    // requested one — reconciliation shows the intent in the reason text.
    const row = await ctx.prisma.loyaltyLedger.findFirstOrThrow({
      where: { userId, source: 'ADMIN_ADJUST', NOT: { reason: { contains: 'genesis' } } },
    });
    expect(row.delta).toBe(-100);
    expect(row.reason).toMatch(/clamped from -500/);
    expect(row.reason).toMatch(/balance was 100/);
  });

  test('positive adjust above any reasonable ceiling still works (no upper clamp)', async () => {
    const seed = await seedReference(ctx.prisma);
    const userId = await mkCustomer(50);

    const r = await ctx.prisma.$transaction(async (tx) => {
      return loyalty.adjust(tx, {
        userId, delta: 1_000_000, actorType: 'ADMIN', actorId: seed.vendorUser.id,
        reason: 'welcome mega gift',
      });
    });
    expect(r.appliedDelta).toBe(1_000_000);
    expect(r.balanceAfter).toBe(1_000_050);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Atomicity — service writes balance + ledger in the same tx
// ═══════════════════════════════════════════════════════════════════════════

describe('LoyaltyService — balance + ledger in one transaction', () => {
  test('a thrown error inside the tx rolls back BOTH the balance and the ledger row', async () => {
    const seed = await seedReference(ctx.prisma);
    const userId = await mkCustomer(200);
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-ROLLBACK', currencyCode: 'QAR',
        activityId: seed.activity.id, vendorId: seed.vendor.id, customerId: userId,
        guests: 1, bookingPhone: '+97455123456', totalPrice: 50, serviceFee: 5, status: 'CONFIRMED',
        startDatetime: new Date('2030-01-05T10:00:00Z'),
        endDatetime:   new Date('2030-01-05T12:00:00Z'),
      },
    });

    // Run redeem inside a tx that we then force to fail.
    await expect(ctx.prisma.$transaction(async (tx) => {
      await loyalty.redeem(tx, { userId, amount: 50, bookingId: booking.id, note: 'will rollback' });
      // After the balance is down to 150 and a ledger row is pending,
      // throw — Postgres must roll back both writes.
      throw new Error('simulated downstream failure');
    })).rejects.toThrow('simulated downstream failure');

    // Atomicity guarantee: neither the balance nor the ledger row persisted.
    // (Genesis row from seeding remains; the redeem's BOOKING_REDEEM row must not.)
    expect(await balanceOf(userId)).toBe(200);
    expect(await ctx.prisma.loyaltyLedger.count({
      where: { userId, source: 'BOOKING_REDEEM' },
    })).toBe(0);
  });
});
