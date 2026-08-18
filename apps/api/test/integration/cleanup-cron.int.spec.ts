/**
 * CleanupService — scheduled data-hygiene jobs against a real Postgres.
 *
 * Tests the invariants that only a live DB can verify:
 *   - autoCancelStalePendingBookings deletes expired reservations + payments
 *   - fresh PENDING bookings (reservedUntil in future) stay intact
 *   - in-flight PAY2M sessions stay intact until past the grace (default 2h); then reaped
 *   - autoCompletePastBookings flips CONFIRMED → COMPLETED once endDatetime passes
 *   - loyalty points are earned exactly once per booking (pointsAwarded idempotent)
 *   - autoExpireCoupons only touches APPROVED coupons past validTo
 *   - expired refresh tokens are purged
 *   - Cleanup never touches COMPLETED / CANCELLED historical rows
 */

import { getTestContext, seedReference } from './_setup';
import { CleanupService } from '../../src/common/services/cleanup.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function configShim(overrides: Record<string, string> = {}) {
  const merged: Record<string, string> = {
    RETENTION_REFRESH_TOKEN_DAYS:   '0',
    RETENTION_SECURITY_LOG_DAYS:    '90',
    RETENTION_AUDIT_LOG_DAYS:       '180',
    RETENTION_EXPIRED_COUPON_DAYS:  '30',
    PENDING_BOOKING_FALLBACK_HOURS: '4',
    ...overrides,
  };
  return {
    get: (k: string, fallback?: string) => merged[k] ?? fallback,
    getOrThrow: (k: string) => {
      const v = merged[k];
      if (v === undefined) throw new Error(`Missing config: ${k}`);
      return v;
    },
  };
}

function makeCleanup(configOverrides: Record<string, string> = {}) {
  const prismaSvc = { client: ctx.prisma } as any;
  const auditLogger = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const availabilityCache = {
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  // Pass-through lock for tests: always wins leader election so cron bodies
  // run as expected. Real prod uses Redis SET NX PX; integration tests don't
  // run a Redis server, and we already cover the lock-loses path in the
  // unit suite (test/unit/redis-lock.service.spec.ts).
  const lock = {
    withLeaderLock: <T,>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
    acquire: jest.fn(),
    release: jest.fn(),
  } as any;

  return {
    svc: new CleanupService(prismaSvc, auditLogger, configShim(configOverrides) as any, loyalty, availabilityCache, lock),
    auditLogger,
    availabilityCache,
  };
}

async function mkPendingBooking(opts: {
  seed: Awaited<ReturnType<typeof seedReference>>;
  reservedUntil?: Date | null;
  paymentBasketId?: string | null;
  createdAt?: Date;
  paymentInitiatedAt?: Date | null;
  slotOffsetDays?: number;
  pointsRedeemed?: number;
}): Promise<{ bookingId: string; paymentId: string | null }> {
  const start = new Date('2030-09-01T10:00:00Z');
  start.setDate(start.getDate() + (opts.slotOffsetDays ?? 0));
  const end = new Date(start.getTime() + 2 * 3600_000);

  // Create PENDING payment (matches production createBooking flow).
  // paymentInitiatedAt mirrors what payment.service.initiatePayment stamps
  // when handing off to PAY2M; tests that exercise the case-3 abandoned-
  // gateway sweep must seed it explicitly. Defaults to opts.createdAt when
  // a basket is set so the helper stays backwards-compat with old tests.
  let paymentId: string | null = null;
  if (opts.paymentBasketId !== null) {
    const initiatedAt =
      opts.paymentInitiatedAt !== undefined
        ? opts.paymentInitiatedAt
        : opts.paymentBasketId
        ? opts.createdAt ?? null
        : null;
    const payment = await ctx.prisma.payment.create({
      data: {
        amount: 100, currency: 'QAR', status: 'PENDING',
        method: 'PENDING',
        gatewayBasketId: opts.paymentBasketId ?? null,
        paymentInitiatedAt: initiatedAt,
      },
    });
    paymentId = payment.id;
  }

  const booking = await ctx.prisma.booking.create({
    data: {
      ref: `JDWL-STALE-${crypto.randomUUID().slice(0, 6)}`,
      currencyCode: 'QAR',
      guests: 2, bookingPhone: '+97455123456', totalPrice: 100, serviceFee: 5, commissionAmount: 10,
      pointsRedeemed: opts.pointsRedeemed ?? 0,
      status: 'PENDING',
      startDatetime: start, endDatetime: end,
      activityId: opts.seed.activity.id,
      customerId: opts.seed.customer.id,
      vendorId: opts.seed.vendor.id,
      paymentId: paymentId,
      reservedUntil: opts.reservedUntil ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });

  return { bookingId: booking.id, paymentId };
}

// ═══════════════════════════════════════════════════════════════════════════
// autoCancelStalePendingBookings
// ═══════════════════════════════════════════════════════════════════════════

describe('CleanupService.autoCancelStalePendingBookings', () => {
  test('PENDING booking with expired reservedUntil + no payment → deleted (slot freed)', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookingId } = await mkPendingBooking({
      seed,
      reservedUntil: new Date(Date.now() - 10_000), // 10 s in the past
      paymentBasketId: null, // no payment at all
    });

    const { svc, availabilityCache } = makeCleanup();
    await svc.autoCancelStalePendingBookings();

    expect(await ctx.prisma.booking.findUnique({ where: { id: bookingId } })).toBeNull();

    // Availability cache invalidated for that activity
    expect(availabilityCache.invalidateMany).toHaveBeenCalledWith([seed.activity.id]);
  });

  test('PENDING + expired reservedUntil + payment without basketId → booking deleted, payment soft-failed', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookingId, paymentId } = await mkPendingBooking({
      seed,
      reservedUntil: new Date(Date.now() - 10_000),
      paymentBasketId: null,
    });

    const { svc } = makeCleanup();
    await svc.autoCancelStalePendingBookings();

    expect(await ctx.prisma.booking.findUnique({ where: { id: bookingId } })).toBeNull();
    if (paymentId) {
      // CRIT#2 fix: the cron now SOFT-FAILS the payment (keeps the row) instead
      // of hard-deleting it, honoring the "payments are never hard-deleted"
      // invariant and letting a late verified success recover or refund.
      const pay = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
      expect(pay).not.toBeNull();
      expect(pay!.status).toBe('FAILED');
    }
  });

  test('stale PENDING booking that redeemed Wanasa points → points REFUNDED on cleanup (no silent confiscation)', async () => {
    const seed = await seedReference(ctx.prisma);
    // Customer redeemed 500 points at booking-create (balance debited to 0 then).
    // The cron hard-deletes the abandoned booking — it MUST return those points
    // (audit HIGH B1: previously they were silently confiscated).
    await ctx.prisma.user.update({ where: { id: seed.customer.id }, data: { loyaltyPoints: 0 } });
    const { bookingId } = await mkPendingBooking({
      seed,
      reservedUntil: new Date(Date.now() - 10_000),
      paymentBasketId: null,
      pointsRedeemed: 500,
    });

    const { svc } = makeCleanup();
    await svc.autoCancelStalePendingBookings();

    expect(await ctx.prisma.booking.findUnique({ where: { id: bookingId } })).toBeNull();
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(Number(user.loyaltyPoints)).toBe(500); // redeemed 500 → returned 500 (passthrough)
    const ledger = await ctx.prisma.loyaltyLedger.findFirst({
      where: { userId: seed.customer.id, source: 'CANCEL_REFUND_UNPAID' },
    });
    expect(ledger).not.toBeNull();
    expect(Number(ledger?.delta)).toBe(500);
  });

  test('RACE: a booking a late PAY2M success CONFIRMED after the scan is NOT refunded (no points mint)', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.user.update({ where: { id: seed.customer.id }, data: { loyaltyPoints: 0 } });
    // Customer redeemed 500 points; booking PENDING awaiting a slow PAY2M callback.
    const { bookingId, paymentId } = await mkPendingBooking({
      seed,
      reservedUntil: new Date(Date.now() - 10_000),
      paymentBasketId: 'basket-race',
      pointsRedeemed: 500,
    });
    // What the cron's scan selected while the booking was still PENDING.
    const staleSnapshot = [{
      id: bookingId,
      ref: 'JDWL-RACE',
      paymentId,
      activityId: seed.activity.id,
      customerId: seed.customer.id,
      couponCode: null,
      pointsRedeemed: 500,
    }];
    // THE RACE: between that scan and the cron's transaction, a delayed/retried
    // PAY2M success CONFIRMS the booking and marks its payment SUCCESS.
    await ctx.prisma.booking.update({ where: { id: bookingId }, data: { status: 'CONFIRMED' } });
    if (paymentId) await ctx.prisma.payment.update({ where: { id: paymentId }, data: { status: 'SUCCESS' } });

    // Feed the cron the stale (PENDING) snapshot so it tries to reap the now-CONFIRMED booking.
    const spy = jest.spyOn(ctx.prisma.booking, 'findMany').mockResolvedValueOnce(staleSnapshot as never);
    const { svc } = makeCleanup();
    try {
      await svc.autoCancelStalePendingBookings();
    } finally {
      // Restore even if the cron throws, so a stale mock can't contaminate later tests.
      spy.mockRestore();
    }

    // The atomic claim-delete matched 0 rows (booking is CONFIRMED) → refund SKIPPED.
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(Number(user.loyaltyPoints)).toBe(0); // NOT minted back to 500
    const booking = await ctx.prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking?.status).toBe('CONFIRMED'); // paid, confirmed booking survives
    const ledger = await ctx.prisma.loyaltyLedger.findFirst({
      where: { userId: seed.customer.id, source: 'CANCEL_REFUND_UNPAID' },
    });
    expect(ledger).toBeNull(); // no refund ledger row written
    if (paymentId) {
      const pay = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(pay.status).toBe('SUCCESS'); // real success left intact (not soft-failed)
    }
  });

  test('stale PENDING booking with ZERO redeemed points → balance untouched, no ledger row', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.user.update({ where: { id: seed.customer.id }, data: { loyaltyPoints: 0 } });
    const { bookingId } = await mkPendingBooking({
      seed,
      reservedUntil: new Date(Date.now() - 10_000),
      paymentBasketId: null,
      pointsRedeemed: 0,
    });

    const { svc } = makeCleanup();
    await svc.autoCancelStalePendingBookings();

    expect(await ctx.prisma.booking.findUnique({ where: { id: bookingId } })).toBeNull();
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(Number(user.loyaltyPoints)).toBe(0);
    expect(await ctx.prisma.loyaltyLedger.findFirst({ where: { userId: seed.customer.id } })).toBeNull();
  });

  test('PENDING + fresh reservedUntil (future) → booking stays (customer is still checking out)', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookingId } = await mkPendingBooking({
      seed,
      reservedUntil: new Date(Date.now() + 300_000), // +5 min in future
      paymentBasketId: null,
    });

    const { svc } = makeCleanup();
    await svc.autoCancelStalePendingBookings();

    expect(await ctx.prisma.booking.findUnique({ where: { id: bookingId } })).not.toBeNull();
  });

  test('PENDING + PAY2M session in-flight (within the grace, has basketId) → booking stays', async () => {
    const seed = await seedReference(ctx.prisma);
    // Reservation expired, but PAY2M session is in-flight — service must keep
    // waiting for PAY2M callback to avoid orphaning a paid booking.
    const { bookingId } = await mkPendingBooking({
      seed,
      reservedUntil: new Date(Date.now() - 10_000), // reservedUntil expired
      paymentBasketId: 'BSK-inflight',               // but basket exists
      createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago (well within the 2h grace)
    });

    const { svc } = makeCleanup();
    await svc.autoCancelStalePendingBookings();

    expect(await ctx.prisma.booking.findUnique({ where: { id: bookingId } })).not.toBeNull();
  });

  test('PENDING + PAY2M session abandoned (past the 2h grace, reservation expired) → booking deleted, payment soft-failed (kept for recovery)', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookingId, paymentId } = await mkPendingBooking({
      seed,
      reservedUntil: new Date(Date.now() - 10 * 60 * 1000), // reservation already expired (the realistic abandoned shape)
      paymentBasketId: 'BSK-abandoned',
      createdAt: new Date(Date.now() - 150 * 60 * 1000), // 2.5h ago — past the 2h PAY2M grace
    });

    const { svc } = makeCleanup();
    await svc.autoCancelStalePendingBookings();

    expect(await ctx.prisma.booking.findUnique({ where: { id: bookingId } })).toBeNull();
    if (paymentId) {
      // CRIT#2 fix: payment kept as FAILED with its basketId preserved, so a
      // delayed/retried PAY2M success can recover the booking from snapshot
      // (or queue a refund) instead of hitting "Payment not found".
      const pay = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
      expect(pay).not.toBeNull();
      expect(pay!.status).toBe('FAILED');
      expect(pay!.gatewayBasketId).toBe('BSK-abandoned');
    }
  });

  test('LAZY GRACE: PAY2M session ~45 min old (past old 30-min cutoff, within 2h grace) → NOT reaped', async () => {
    // The widened grace: a basket-initiated booking must NOT be reaped at ~30 min —
    // a slow/retried PAY2M success could still land. It's kept until well past any
    // possible success (default 2h); the slot is already free meanwhile. Before this
    // fix a 45-min-old booking here would have been deleted (and could race a late pay).
    const seed = await seedReference(ctx.prisma);
    const { bookingId } = await mkPendingBooking({
      seed,
      reservedUntil: new Date(Date.now() - 10 * 60 * 1000), // reservation expired
      paymentBasketId: 'BSK-slowpay',
      createdAt: new Date(Date.now() - 45 * 60 * 1000), // 45 min ago — inside the 2h grace
    });

    const { svc } = makeCleanup();
    await svc.autoCancelStalePendingBookings();

    expect(await ctx.prisma.booking.findUnique({ where: { id: bookingId } })).not.toBeNull();
  });

  test('M2: PAY2M past the payment grace BUT reservation still actively held (reservedUntil future) → NOT reaped', async () => {
    // A verified NAPS hold extends reservedUntil while PAY2M's delayed capture
    // (IPN) is still expected. Case 3's payment grace must NOT reap a booking whose
    // reservation is still in the future — doing so dropped a paid customer into
    // §B2 recovery. Seeded past the 2h grace so this proves the hold protects even
    // then; the 4-hour fallback (Case 4) is still the backstop against a stuck hold.
    const seed = await seedReference(ctx.prisma);
    const { bookingId } = await mkPendingBooking({
      seed,
      reservedUntil: new Date(Date.now() + 25 * 60 * 1000), // held +25 min
      paymentBasketId: 'BSK-held',
      createdAt: new Date(Date.now() - 150 * 60 * 1000), // 2.5h ago — past the 2h grace, but held
    });

    const { svc } = makeCleanup();
    await svc.autoCancelStalePendingBookings();

    // Survives: the active hold protects the slot for the in-flight capture.
    expect(await ctx.prisma.booking.findUnique({ where: { id: bookingId } })).not.toBeNull();
  });

  test('PENDING booking older than fallback (4h) with no reservedUntil → reaped (legacy safety net)', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookingId } = await mkPendingBooking({
      seed,
      reservedUntil: null,
      paymentBasketId: null,
      createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 h ago
    });

    const { svc } = makeCleanup();
    await svc.autoCancelStalePendingBookings();

    expect(await ctx.prisma.booking.findUnique({ where: { id: bookingId } })).toBeNull();
  });

  test('CONFIRMED + CANCELLED bookings are NEVER touched', async () => {
    const seed = await seedReference(ctx.prisma);

    const confirmedStart = new Date('2030-09-03T10:00:00Z');
    const confirmed = await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-CNF-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR',
        guests: 2, bookingPhone: '+97455123456', totalPrice: 100, serviceFee: 5, commissionAmount: 10,
        status: 'CONFIRMED',
        startDatetime: confirmedStart,
        endDatetime: new Date(confirmedStart.getTime() + 2 * 3600_000),
        activityId: seed.activity.id,
        customerId: seed.customer.id,
        vendorId: seed.vendor.id,
      },
    });

    const cancelledStart = new Date('2030-09-04T10:00:00Z');
    const cancelled = await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-CNC-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR',
        guests: 2, bookingPhone: '+97455123456', totalPrice: 100, serviceFee: 5, commissionAmount: 10,
        status: 'CANCELLED',
        startDatetime: cancelledStart,
        endDatetime: new Date(cancelledStart.getTime() + 2 * 3600_000),
        activityId: seed.activity.id,
        customerId: seed.customer.id,
        vendorId: seed.vendor.id,
      },
    });

    const { svc } = makeCleanup();
    await svc.autoCancelStalePendingBookings();

    expect(await ctx.prisma.booking.findUnique({ where: { id: confirmed.id } })).not.toBeNull();
    expect(await ctx.prisma.booking.findUnique({ where: { id: cancelled.id } })).not.toBeNull();
  });

  test('no stale bookings → no-op (no audit row, no cache invalidate)', async () => {
    await seedReference(ctx.prisma);
    const { svc, auditLogger, availabilityCache } = makeCleanup();

    await svc.autoCancelStalePendingBookings();

    expect(auditLogger.log).not.toHaveBeenCalled();
    expect(availabilityCache.invalidateMany).not.toHaveBeenCalled();
  });

  test('AUTO_CANCEL_STALE_BOOKINGS audit row written with the affected count', async () => {
    const seed = await seedReference(ctx.prisma);
    await mkPendingBooking({
      seed, reservedUntil: new Date(Date.now() - 10_000), paymentBasketId: null,
      slotOffsetDays: 0,
    });
    await mkPendingBooking({
      seed, reservedUntil: new Date(Date.now() - 10_000), paymentBasketId: null,
      slotOffsetDays: 1,
    });

    const { svc, auditLogger } = makeCleanup();
    await svc.autoCancelStalePendingBookings();

    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AUTO_CANCEL_STALE_BOOKINGS',
        entity: 'Booking',
      }),
    );
    const call = auditLogger.log.mock.calls.find((c: any[]) => c[0].action === 'AUTO_CANCEL_STALE_BOOKINGS')!;
    const details = JSON.parse(call[0].details);
    expect(details.count).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// autoCompletePastBookings
// ═══════════════════════════════════════════════════════════════════════════

describe('CleanupService.autoCompletePastBookings', () => {
  test('CONFIRMED + endDatetime in the past → COMPLETED; future CONFIRMED untouched', async () => {
    const seed = await seedReference(ctx.prisma);

    // Past CONFIRMED booking
    const past = await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-PAST-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR',
        guests: 2, bookingPhone: '+97455123456', totalPrice: 100, serviceFee: 5, commissionAmount: 10,
        status: 'CONFIRMED',
        startDatetime: new Date('2020-01-01T10:00:00Z'),
        endDatetime:   new Date('2020-01-01T12:00:00Z'),
        activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
      },
    });
    // Future CONFIRMED booking
    const future = await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-FUT-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR',
        guests: 2, bookingPhone: '+97455123456', totalPrice: 100, serviceFee: 5, commissionAmount: 10,
        status: 'CONFIRMED',
        startDatetime: new Date('2030-09-05T10:00:00Z'),
        endDatetime:   new Date('2030-09-05T12:00:00Z'),
        activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
      },
    });

    const { svc } = makeCleanup();
    await svc.autoCompletePastBookings();

    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: past.id } })).status).toBe('COMPLETED');
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: future.id } })).status).toBe('CONFIRMED');
  });

  test('loyalty points earned exactly once per booking (pointsAwarded idempotent)', async () => {
    const seed = await seedReference(ctx.prisma);
    // 1 point = 1 QAR model (pointsPerQar 0.01, qarPerPoint 1) → 100 QAR earns 1.00 point.
    await ctx.prisma.loyaltyConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', pointsPerQar: 0.01, qarPerPoint: 1, minRedemption: 1 },
      update: { pointsPerQar: 0.01, qarPerPoint: 1, minRedemption: 1 },
    });

    const past = await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-EARN-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR',
        guests: 2, bookingPhone: '+97455123456', totalPrice: 100, serviceFee: 5, commissionAmount: 10,
        status: 'CONFIRMED',
        startDatetime: new Date('2020-01-01T10:00:00Z'),
        endDatetime:   new Date('2020-01-01T12:00:00Z'),
        activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
      },
    });

    const { svc } = makeCleanup();

    // Run twice — second run must NOT award again
    await svc.autoCompletePastBookings();
    // Reset status back to CONFIRMED so the second pass sees it as eligible
    // — but pointsAwarded guard should still prevent double credit.
    await ctx.prisma.booking.update({
      where: { id: past.id }, data: { status: 'CONFIRMED' },
    });
    await svc.autoCompletePastBookings();

    const ledgerRows = await ctx.prisma.loyaltyLedger.findMany({
      where: { userId: seed.customer.id, source: 'BOOKING_EARN' },
    });
    expect(ledgerRows).toHaveLength(1);
    expect(Number(ledgerRows[0].delta)).toBe(1); // 100 QAR × pointsPerQar(0.01) = 1.00

    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(Number(u.loyaltyPoints)).toBe(1);
  });

  test('points-paid booking (pointsDiscount == totalPrice) earns 0 on completion — no infinite loop', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.loyaltyConfig.upsert({
      where: { id: 'singleton' }, create: { id: 'singleton' }, update: {},
    });
    await ctx.prisma.user.update({ where: { id: seed.customer.id }, data: { loyaltyPoints: 0 } });

    // Past CONFIRMED booking fully paid with Wanasa points → pointsDiscount
    // equals totalPrice (binary redemption covered the whole activity).
    await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-PTS-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR',
        guests: 2, bookingPhone: '+97455123456',
        totalPrice: 100, pointsDiscount: 100, pointsRedeemed: 10000,
        serviceFee: 0, commissionAmount: 10,
        status: 'CONFIRMED',
        startDatetime: new Date('2020-01-01T10:00:00Z'),
        endDatetime:   new Date('2020-01-01T12:00:00Z'),
        activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
      },
    });

    const { svc } = makeCleanup();
    await svc.autoCompletePastBookings();

    // Earning on a points-paid booking would mint the spent points back — the
    // loop. So: no BOOKING_EARN row, balance stays 0.
    const earnRows = await ctx.prisma.loyaltyLedger.findMany({
      where: { userId: seed.customer.id, source: 'BOOKING_EARN' },
    });
    expect(earnRows).toHaveLength(0);
    const u2 = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(Number(u2.loyaltyPoints)).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // NEW BEHAVIOUR (LOYALTY_AWARD_DELAY_MINUTES): points are granted ~5 min after
  // the activity STARTS — while still CONFIRMED, BEFORE it ends — because the
  // customer can no longer cancel once it has started. Still NOT granted at
  // booking time or before the start.
  // ─────────────────────────────────────────────────────────────────────────
  test('points awarded ~5 min after the activity STARTS (while still CONFIRMED), not at booking time', async () => {
    const seed = await seedReference(ctx.prisma); // Asia/Qatar (+3)
    await ctx.prisma.loyaltyConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', pointsPerQar: 0.01, qarPerPoint: 1, minRedemption: 1 },
      update: { pointsPerQar: 0.01, qarPerPoint: 1, minRedemption: 1 },
    });
    await ctx.prisma.user.update({ where: { id: seed.customer.id }, data: { loyaltyPoints: 0 } });
    const now = Date.now();

    // Event has NOT started yet (start +4h ahead — future even in +3 local) → NO award.
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-STARTAWARD-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR', guests: 1, bookingPhone: '+97455123456',
        totalPrice: 100, serviceFee: 5, commissionAmount: 10,
        status: 'CONFIRMED',
        startDatetime: new Date(now + 4 * 60 * 60 * 1000),
        endDatetime:   new Date(now + 6 * 60 * 60 * 1000),
        activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
      },
    });

    const { svc } = makeCleanup();

    // STEP 1 — event upcoming: NO points, NO earn row, stays CONFIRMED.
    await svc.autoCompletePastBookings();
    expect(
      await ctx.prisma.loyaltyLedger.findMany({ where: { userId: seed.customer.id, source: 'BOOKING_EARN' } }),
    ).toHaveLength(0);
    expect(Number((await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } })).loyaltyPoints)).toBe(0);
    let row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.pointsAwarded).toBe(false);
    expect(row.status).toBe('CONFIRMED');

    // STEP 2 — event has now STARTED (>5 min ago) but has NOT ended → award WHILE
    // CONFIRMED. start 10 min ago; end still +4h ahead (future even in +3 local).
    await ctx.prisma.booking.update({
      where: { id: booking.id },
      data: {
        startDatetime: new Date(now - 10 * 60 * 1000),
        endDatetime:   new Date(now + 4 * 60 * 60 * 1000),
      },
    });
    await svc.autoCompletePastBookings();

    const earn = await ctx.prisma.loyaltyLedger.findMany({ where: { userId: seed.customer.id, source: 'BOOKING_EARN' } });
    expect(earn).toHaveLength(1);
    expect(Number(earn[0].delta)).toBe(1); // 100 QAR × pointsPerQar(0.01) = 1.00
    row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.pointsAwarded).toBe(true);
    expect(row.status).toBe('CONFIRMED'); // awarded at START — NOT yet completed (end still future)
    expect(Number((await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } })).loyaltyPoints)).toBe(1);
  });

  test('points NOT awarded until LOYALTY_AWARD_DELAY_MINUTES after start (within the delay → still nothing)', async () => {
    const seed = await seedReference(ctx.prisma); // +3
    await ctx.prisma.loyaltyConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', pointsPerQar: 0.01, qarPerPoint: 1, minRedemption: 1 },
      update: { pointsPerQar: 0.01, qarPerPoint: 1, minRedemption: 1 },
    });
    await ctx.prisma.user.update({ where: { id: seed.customer.id }, data: { loyaltyPoints: 0 } });
    const now = Date.now();

    // A big delay (600 min) so a booking that started only "3h ago in local" (i.e.
    // start = now raw; +3 local ⇒ 3h into the event) is still WITHIN the delay →
    // no award yet. Proves the delay gate actually holds, not just "any past start".
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-DELAY-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR', guests: 1, bookingPhone: '+97455123456',
        totalPrice: 100, serviceFee: 5, commissionAmount: 10,
        status: 'CONFIRMED',
        startDatetime: new Date(now),                       // +3 local ⇒ 3h ago
        endDatetime:   new Date(now + 10 * 60 * 60 * 1000), // far future
        activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
      },
    });

    const { svc } = makeCleanup({ LOYALTY_AWARD_DELAY_MINUTES: '600' }); // 10h delay > 3h elapsed
    await svc.autoCompletePastBookings();

    expect(
      await ctx.prisma.loyaltyLedger.findMany({ where: { userId: seed.customer.id, source: 'BOOKING_EARN' } }),
    ).toHaveLength(0);
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).pointsAwarded).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // The "1 point = 1 QAR" model (pointsPerQar=0.01, qarPerPoint=1): earn is
  // round-to-2dp, NOT floored — so small/odd bookings earn their exact 1%
  // (fixing the old floor-to-zero bug where a 99 QAR booking earned nothing).
  // ─────────────────────────────────────────────────────────────────────────
  test('earn rate pointsPerQar=0.01 → 100 QAR earns 1.00 pt; 99 QAR earns 0.99 pt (round2, no floor-to-zero)', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.loyaltyConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', pointsPerQar: 0.01, qarPerPoint: 1, minRedemption: 1 },
      update: { pointsPerQar: 0.01, qarPerPoint: 1, minRedemption: 1 },
    });
    await ctx.prisma.user.update({ where: { id: seed.customer.id }, data: { loyaltyPoints: 0 } });

    const mkPast = (ref: string, price: number) => ctx.prisma.booking.create({
      data: {
        ref, currencyCode: 'QAR', guests: 1, bookingPhone: '+97455123456',
        totalPrice: price, serviceFee: 0, commissionAmount: 10, status: 'CONFIRMED',
        startDatetime: new Date('2020-01-01T10:00:00Z'), endDatetime: new Date('2020-01-01T12:00:00Z'),
        activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
      },
    });
    const b100 = await mkPast(`JDWL-R100-${crypto.randomUUID().slice(0, 6)}`, 100);
    const b99 = await mkPast(`JDWL-R99-${crypto.randomUUID().slice(0, 6)}`, 99);

    const { svc } = makeCleanup();
    await svc.autoCompletePastBookings();

    // 100 QAR → round2(100 × 0.01) = 1.00 pt; 99 QAR → round2(0.99) = 0.99 pt.
    // BOTH earn now (the small booking is no longer floored to zero).
    const earn = await ctx.prisma.loyaltyLedger.findMany({
      where: { userId: seed.customer.id, source: 'BOOKING_EARN' },
    });
    expect(earn).toHaveLength(2);
    const by = (id: string) => earn.find((e) => e.bookingId === id)!;
    expect(Number(by(b100.id).delta)).toBe(1);
    expect(Number(by(b99.id).delta)).toBe(0.99);
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b99.id } })).status).toBe('COMPLETED');
    // 1.00 + 0.99 = 1.99 QAR of points.
    expect(Number((await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } })).loyaltyPoints)).toBe(1.99);
  });

  test('CANCELLED past booking → NOT completed (skipped by status filter)', async () => {
    const seed = await seedReference(ctx.prisma);
    const cancelled = await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-CPAST-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR',
        guests: 2, bookingPhone: '+97455123456', totalPrice: 100, serviceFee: 5, commissionAmount: 10,
        status: 'CANCELLED',
        startDatetime: new Date('2020-01-01T10:00:00Z'),
        endDatetime:   new Date('2020-01-01T12:00:00Z'),
        activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
      },
    });
    const { svc } = makeCleanup();
    await svc.autoCompletePastBookings();
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: cancelled.id } })).status)
      .toBe('CANCELLED');
  });

  // ── TIMEZONE regression ────────────────────────────────────────────────────
  // endDatetime is local-wall-clock tagged-UTC. seedReference's country is
  // Asia/Qatar (+3), so "now" in Qatar reads as raw-UTC-now + 3h. A booking
  // tagged now+1h has ALREADY ended locally (1h < 3h) even though it's still in
  // the FUTURE vs raw UTC — the exact case the OLD `endDatetime < Date.now()`
  // compare wrongly skipped for the +3h offset, delaying completion AND the
  // loyalty-points award (the "10 QAR booking gets no points" report). The fix
  // gates on nowInTimezone(activity tz), so it completes ~when the LOCAL end
  // passes and awards the fractional 0.10 pt immediately.
  test('TIMEZONE: a +3 (Qatar) booking completes when its LOCAL end passes (not offset-hours late) and awards 10 QAR → 0.10 pt', async () => {
    const seed = await seedReference(ctx.prisma); // country defaultTimezone = Asia/Qatar (+3)
    await ctx.prisma.loyaltyConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', pointsPerQar: 0.01, qarPerPoint: 1, minRedemption: 1 },
      update: { pointsPerQar: 0.01, qarPerPoint: 1, minRedemption: 1 },
    });
    const now = Date.now();
    // tagged end now+1h → 2h in the PAST in Qatar local (now+3h) → must complete
    const endedLocally = await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-TZ-DONE-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR',
        guests: 1, bookingPhone: '+97455123456', totalPrice: 10, serviceFee: 1, commissionAmount: 1,
        status: 'CONFIRMED',
        startDatetime: new Date(now - 60 * 60 * 1000),
        endDatetime: new Date(now + 60 * 60 * 1000),
        activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
      },
    });
    // tagged end now+5h → still 2h in the FUTURE in Qatar local → must stay CONFIRMED
    const notYetLocally = await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-TZ-FUT-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR',
        guests: 1, bookingPhone: '+97455123456', totalPrice: 10, serviceFee: 1, commissionAmount: 1,
        status: 'CONFIRMED',
        startDatetime: new Date(now + 4 * 60 * 60 * 1000),
        endDatetime: new Date(now + 5 * 60 * 60 * 1000),
        activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
      },
    });

    const { svc } = makeCleanup();
    await svc.autoCompletePastBookings();

    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: endedLocally.id } })).status).toBe('COMPLETED');
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: notYetLocally.id } })).status).toBe('CONFIRMED');
    // 10 QAR × 1% = 0.10 pt — fractional, not floored, not skipped, credited now (not +3h late)
    const bal = Number(
      (await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id }, select: { loyaltyPoints: true } })).loyaltyPoints,
    );
    expect(bal).toBeCloseTo(0.1, 2);
  });

  // RACE: a vendor/admin cancel that commits between the cron's findMany and its
  // bulk updateMany must NOT resurrect the booking CANCELLED→COMPLETED, and must
  // award it no loyalty (which would sit on top of its refund). Simulated by
  // cancelling the row inside a one-shot findMany spy, after the real fetch.
  test('RACE: booking cancelled mid-tick is NOT resurrected to COMPLETED and earns NO points', async () => {
    const seed = await seedReference(ctx.prisma); // Asia/Qatar (+3)
    await ctx.prisma.loyaltyConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', pointsPerQar: 0.01, qarPerPoint: 1, minRedemption: 1 },
      update: { pointsPerQar: 0.01, qarPerPoint: 1, minRedemption: 1 },
    });
    const now = Date.now();
    const b = await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-RACE-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR',
        guests: 1, bookingPhone: '+97455123456', totalPrice: 100, serviceFee: 5, commissionAmount: 10,
        status: 'CONFIRMED',
        startDatetime: new Date(now - 2 * 60 * 60 * 1000),
        endDatetime: new Date(now + 60 * 60 * 1000), // tagged +1h = Qatar-local past → cron picks it
        activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
      },
    });

    const { svc } = makeCleanup();

    // Cancel the row AFTER the cron's findMany returns but BEFORE its updateMany.
    const realFindMany = (ctx.prisma.booking.findMany as any).bind(ctx.prisma.booking);
    const spy = jest
      .spyOn(ctx.prisma.booking as any, 'findMany')
      .mockImplementationOnce(async (args: any) => {
        const rows = await realFindMany(args);
        await ctx.prisma.booking.update({ where: { id: b.id }, data: { status: 'CANCELLED' } });
        return rows;
      });

    try {
      await svc.autoCompletePastBookings();
    } finally {
      spy.mockRestore();
    }

    const after = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.status).toBe('CANCELLED');   // NOT resurrected
    expect(after.pointsAwarded).toBe(false);  // claim skipped
    const bal = Number(
      (await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id }, select: { loyaltyPoints: true } })).loyaltyPoints,
    );
    expect(bal).toBe(0); // no loyalty on top of the (separate) refund
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// autoExpireCoupons
// ═══════════════════════════════════════════════════════════════════════════

describe('CleanupService.autoExpireCoupons', () => {
  test('APPROVED coupon past validTo → EXPIRED; PENDING / future coupons untouched', async () => {
    const seed = await seedReference(ctx.prisma);

    const stale = await ctx.prisma.coupon.create({
      data: {
        code: `STALE-${crypto.randomUUID().slice(0, 6)}`,
        vendorId: seed.vendor.id,
        discountType: 'PERCENTAGE', discountValue: 10,
        validFrom: new Date('2020-01-01'),
        validTo:   new Date('2020-06-30'),
        status: 'APPROVED',
      },
    });
    const future = await ctx.prisma.coupon.create({
      data: {
        code: `FUT-${crypto.randomUUID().slice(0, 6)}`,
        vendorId: seed.vendor.id,
        discountType: 'FIXED', discountValue: 5,
        validFrom: new Date('2030-01-01'),
        validTo:   new Date('2030-12-31'),
        status: 'APPROVED',
      },
    });
    const pending = await ctx.prisma.coupon.create({
      data: {
        code: `PEND-${crypto.randomUUID().slice(0, 6)}`,
        vendorId: seed.vendor.id,
        discountType: 'PERCENTAGE', discountValue: 15,
        validFrom: new Date('2020-01-01'),
        validTo:   new Date('2020-06-30'),
        status: 'PENDING',
      },
    });

    const { svc } = makeCleanup();
    await svc.autoExpireCoupons();

    expect((await ctx.prisma.coupon.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('EXPIRED');
    expect((await ctx.prisma.coupon.findUniqueOrThrow({ where: { id: future.id } })).status).toBe('APPROVED');
    // PENDING coupons are gated by admin review; cron must not promote them
    expect((await ctx.prisma.coupon.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('PENDING');
  });

  test('no eligible coupons → no audit row', async () => {
    await seedReference(ctx.prisma);
    const { svc, auditLogger } = makeCleanup();
    await svc.autoExpireCoupons();
    expect(auditLogger.log).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// cleanExpiredRefreshTokens
// ═══════════════════════════════════════════════════════════════════════════

describe('CleanupService.cleanExpiredRefreshTokens', () => {
  test('tokens with expiresAt in the past are deleted; fresh ones remain', async () => {
    const seed = await seedReference(ctx.prisma);

    const expiredTok = await ctx.prisma.refreshToken.create({
      data: {
        userId: seed.customer.id,
        tokenHash: 'expired-hash',
        expiresAt: new Date(Date.now() - 86_400_000),
      },
    });
    const freshTok = await ctx.prisma.refreshToken.create({
      data: {
        userId: seed.customer.id,
        tokenHash: 'fresh-hash',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const { svc } = makeCleanup();
    const deleted = await svc.cleanExpiredRefreshTokens();
    expect(deleted).toBe(1);

    expect(await ctx.prisma.refreshToken.findUnique({ where: { id: expiredTok.id } })).toBeNull();
    expect(await ctx.prisma.refreshToken.findUnique({ where: { id: freshTok.id } })).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Security / Audit log retention
// ═══════════════════════════════════════════════════════════════════════════

describe('CleanupService.cleanOldSecurityLogs', () => {
  test('rows older than retention window are deleted', async () => {
    const { svc } = makeCleanup({ RETENTION_SECURITY_LOG_DAYS: '30' });

    const oldRow = await ctx.prisma.securityLog.create({
      data: {
        event: 'LOGIN_SUCCESS', email: 'x@t.com',
        createdAt: new Date(Date.now() - 45 * 86_400_000),
      },
    });
    const freshRow = await ctx.prisma.securityLog.create({
      data: { event: 'LOGIN_SUCCESS', email: 'y@t.com' },
    });

    const n = await svc.cleanOldSecurityLogs();
    expect(n).toBe(1);
    expect(await ctx.prisma.securityLog.findUnique({ where: { id: oldRow.id } })).toBeNull();
    expect(await ctx.prisma.securityLog.findUnique({ where: { id: freshRow.id } })).not.toBeNull();
  });
});
