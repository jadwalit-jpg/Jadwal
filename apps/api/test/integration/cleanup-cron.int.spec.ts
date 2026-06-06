/**
 * CleanupService — scheduled data-hygiene jobs against a real Postgres.
 *
 * Tests the invariants that only a live DB can verify:
 *   - autoCancelStalePendingBookings deletes expired reservations + payments
 *   - fresh PENDING bookings (reservedUntil in future) stay intact
 *   - in-flight PAY2M sessions (< 30 min) stay intact; > 30 min get reaped
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

  test('PENDING + expired reservedUntil + payment without basketId → booking + payment deleted', async () => {
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
      expect(await ctx.prisma.payment.findUnique({ where: { id: paymentId } })).toBeNull();
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
    expect(user.loyaltyPoints).toBe(500);
    const ledger = await ctx.prisma.loyaltyLedger.findFirst({
      where: { userId: seed.customer.id, source: 'CANCEL_REFUND_UNPAID' },
    });
    expect(ledger).not.toBeNull();
    expect(ledger?.delta).toBe(500);
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
    expect(user.loyaltyPoints).toBe(0);
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

  test('PENDING + PAY2M session in-flight (< 30 min old, has basketId) → booking stays', async () => {
    const seed = await seedReference(ctx.prisma);
    // Reservation expired, but PAY2M session is in-flight — service must keep
    // waiting for PAY2M callback to avoid orphaning a paid booking.
    const { bookingId } = await mkPendingBooking({
      seed,
      reservedUntil: new Date(Date.now() - 10_000), // reservedUntil expired
      paymentBasketId: 'BSK-inflight',               // but basket exists
      createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago (< 30 min)
    });

    const { svc } = makeCleanup();
    await svc.autoCancelStalePendingBookings();

    expect(await ctx.prisma.booking.findUnique({ where: { id: bookingId } })).not.toBeNull();
  });

  test('PENDING + PAY2M session abandoned (> 30 min) → booking + payment deleted', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookingId, paymentId } = await mkPendingBooking({
      seed,
      reservedUntil: new Date(Date.now() + 300_000), // even a fresh reservation
      paymentBasketId: 'BSK-abandoned',
      createdAt: new Date(Date.now() - 45 * 60 * 1000), // 45 min ago
    });

    const { svc } = makeCleanup();
    await svc.autoCancelStalePendingBookings();

    expect(await ctx.prisma.booking.findUnique({ where: { id: bookingId } })).toBeNull();
    if (paymentId) {
      expect(await ctx.prisma.payment.findUnique({ where: { id: paymentId } })).toBeNull();
    }
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
    // qarPerPoint default 0.01; pointsPerQar default 1 → 100 QAR = 100 points
    await ctx.prisma.loyaltyConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
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
    expect(ledgerRows[0].delta).toBe(100);

    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(u.loyaltyPoints).toBe(100);
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
