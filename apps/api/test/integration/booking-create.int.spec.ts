/**
 * BookingsService.createBooking — the money path, end-to-end.
 *
 * This test was deferred at the unit tier because mocking the Serializable
 * $transaction meaningfully is fragile. It's the highest-value suite in the
 * project — the booking create flow wires together capacity check, coupon,
 * loyalty redeem, payment creation, idempotency, and reservation timer.
 *
 * Every branch in the sequence:
 *   - guards (activity exists, active, vendor active, date window)
 *   - hourly slot validation (on the hour, within operating window)
 *   - capacity: per-activity OR per-unit
 *   - pricing: PER_PERSON × guests, extras, coupon, loyalty
 *   - WANASA-only path (payableAmount=0) → CONFIRMED, no PAY2M
 *   - Standard path (payableAmount>0) → PENDING + reservedUntil
 *   - Loyalty decrement atomic + ledger row
 *   - Idempotency key: second submit returns first booking
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
  const auditLogger = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const notificationService = {
    send: jest.fn().mockResolvedValue(undefined),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
    sendToMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const redisLock = {
    acquire: jest.fn().mockResolvedValue('lock-token'),
    release: jest.fn().mockResolvedValue(undefined),
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
  const loyalty = new LoyaltyService(prismaSvc);
  const availabilityCache = {
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;

  return {
    svc: new BookingsService(
      prismaSvc, auditLogger, notificationService, redisLock,
      configService, loyalty, availabilityCache,
    ),
    notificationService,
    availabilityCache,
  };
}

/** YYYY-MM-DD for a date in the near future (past the "past date" guard). */
function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════════════
// Happy path — HOURLY booking with PAY2M (default)
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.createBooking — HOURLY happy path (PAY2M)', () => {
  test('creates PENDING booking with reservedUntil + PENDING payment', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();

    const result = await svc.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7),
      slotTime: '10:00',
      guests: 2,
      bookingPhone: '+97455123456',
    });

    expect(result.booking).toBeDefined();
    const b = await ctx.prisma.booking.findUniqueOrThrow({
      where: { id: result.booking.id },
      include: { payment: true },
    });
    expect(b.status).toBe('PENDING');
    expect(b.guests).toBe(2);
    expect(b.customerId).toBe(seed.customer.id);
    expect(b.vendorId).toBe(seed.vendor.id);
    expect(b.reservedUntil).toBeInstanceOf(Date);
    // ReservedUntil is ~15 min in the future
    const diff = b.reservedUntil!.getTime() - Date.now();
    expect(diff).toBeGreaterThan(10 * 60 * 1000);
    expect(diff).toBeLessThan(20 * 60 * 1000);

    // Total price = 2 guests × 100 QAR = 200
    expect(Number(b.totalPrice)).toBe(200);
    // Service fee seeded at 5 QAR (country-level)
    expect(Number(b.serviceFee)).toBe(5);
    // Commission = 10% of 200 = 20 (platform default)
    expect(Number(b.commissionAmount)).toBe(20);

    // Payment row exists, PENDING
    expect(b.payment).toBeDefined();
    expect(b.payment!.status).toBe('PENDING');
    expect(Number(b.payment!.amount)).toBe(205); // 200 + 5 service fee
  });

  test('regression: payments.bookingId is populated after createBooking (fixes latent callback bug)', async () => {
    // The PAY2M `handleCallback` reads `payment.bookingId` (the reverse
    // scalar, NOT the Prisma FK). Prior to the 2026-04-22 fix, this column
    // was never written — any real callback would throw
    // "Argument `id` must not be null". This test pins the fix.
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();

    const res = await svc.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7),
      slotTime: '10:00',
      guests: 1,
      bookingPhone: '+97455123456',
    });

    const b = await ctx.prisma.booking.findUniqueOrThrow({
      where: { id: res.booking.id },
    });
    const p = await ctx.prisma.payment.findUniqueOrThrow({
      where: { id: b.paymentId! },
    });
    expect(p.bookingId).toBe(b.id);
  });

  test('booking ref starts with "JDWL-" and is unique', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();

    const res1 = await svc.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7),
      slotTime: '10:00',
      guests: 1,
      bookingPhone: '+97455123456',
    });
    const res2 = await svc.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(8),
      slotTime: '10:00',
      guests: 1,
      bookingPhone: '+97455123456',
    });

    expect(res1.booking.ref).toMatch(/^JDWL-/);
    expect(res2.booking.ref).toMatch(/^JDWL-/);
    expect(res1.booking.ref).not.toBe(res2.booking.ref);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Guards — activity + vendor + date sanity
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.createBooking — guards', () => {
  test('activity not found → NotFoundException', async () => {
    await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();
    await expect(
      svc.createBooking('00000000-0000-4000-8000-000000000001', {
        activityId: '00000000-0000-4000-8000-0000000000ff',
        checkInDate: futureDate(7),
        slotTime: '10:00',
        guests: 1,
      bookingPhone: '+97455123456',
      }),
    ).rejects.toThrow(/not found/i);
  });

  test('activity status INACTIVE → BadRequestException', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.activity.update({
      where: { id: seed.activity.id }, data: { status: 'INACTIVE' },
    });
    const { svc } = makeBookingsService();
    await expect(
      svc.createBooking(seed.customer.id, {
        activityId: seed.activity.id,
        checkInDate: futureDate(7),
        slotTime: '10:00',
        guests: 1,
      bookingPhone: '+97455123456',
      }),
    ).rejects.toThrow(/not available/i);
  });

  test('vendor SUSPENDED → BadRequestException', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.vendor.update({
      where: { id: seed.vendor.id }, data: { status: 'SUSPENDED' },
    });
    const { svc } = makeBookingsService();
    await expect(
      svc.createBooking(seed.customer.id, {
        activityId: seed.activity.id,
        checkInDate: futureDate(7),
        slotTime: '10:00',
        guests: 1,
      bookingPhone: '+97455123456',
      }),
    ).rejects.toThrow(/vendor.*not active/i);
  });

  test('past check-in date → BadRequestException', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();
    await expect(
      svc.createBooking(seed.customer.id, {
        activityId: seed.activity.id,
        checkInDate: '2020-01-01',
        slotTime: '10:00',
        guests: 1,
      bookingPhone: '+97455123456',
      }),
    ).rejects.toThrow(/past date/i);
  });

  test('date beyond max-advance window → BadRequestException', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();
    await expect(
      svc.createBooking(seed.customer.id, {
        activityId: seed.activity.id,
        checkInDate: futureDate(365 * 3), // 3 years out (max is 2)
        slotTime: '10:00',
        guests: 1,
      bookingPhone: '+97455123456',
      }),
    ).rejects.toThrow(/more than.*year/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Idempotency
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.createBooking — idempotency', () => {
  test('same idempotencyKey from same user → returns original booking (idempotent:true)', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();
    const key = crypto.randomUUID();

    const first = await svc.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7),
      slotTime: '10:00',
      guests: 2,
      bookingPhone: '+97455123456',
      idempotencyKey: key,
    });
    const second = await svc.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7),
      slotTime: '10:00',
      guests: 2,
      bookingPhone: '+97455123456',
      idempotencyKey: key,
    });

    expect(second.idempotent).toBe(true);
    expect(second.booking.id).toBe(first.booking.id);
    // Only ONE booking row
    expect(await ctx.prisma.booking.count()).toBe(1);
  });

  test('same idempotencyKey from DIFFERENT user → rejected (IDOR-hardened, post-PR-#94)', async () => {
    // Updated 2026-05-02. Predates PR #94 (commit 101d018). Originally
    // surfaced a custom "Not yours" message; the IDOR fix scopes the
    // idempotency lookup by `customerId: userId`, so the foreign key
    // is "not found" for the second user, the create proceeds, and the
    // DB unique constraint catches the real collision (P2002 → mapped
    // to generic 409 by PrismaExceptionFilter at the HTTP layer; in
    // service-level tests it bubbles as a PrismaClientKnownRequestError).
    // The CONTRACT we test now is just "second user is blocked", not
    // any specific message — both branches return identical responses
    // to collapse the enumeration oracle.
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();
    const key = crypto.randomUUID();

    await svc.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7),
      slotTime: '10:00',
      guests: 1,
      bookingPhone: '+97455123456',
      idempotencyKey: key,
    });

    // Create a second customer user
    const other = await ctx.prisma.user.create({
      data: {
        fullName: 'Other', email: `other-${crypto.randomUUID().slice(0, 6)}@t.com`,
        password: '$2b$10$dummy', role: 'CUSTOMER', emailVerified: true,
      },
    });

    await expect(
      svc.createBooking(other.id, {
        activityId: seed.activity.id,
        checkInDate: futureDate(8),
        slotTime: '10:00',
        guests: 1,
      bookingPhone: '+97455123456',
        idempotencyKey: key,
      }),
    ).rejects.toThrow(); // P2002 / unique-constraint conflict; specific
                        // message is intentionally generic per IDOR rule.
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Capacity — seats consumed + overbooking
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.createBooking — capacity enforcement', () => {
  /** Create N extra customer users for multi-customer-same-slot scenarios. */
  async function makeCustomers(n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const u = await ctx.prisma.user.create({
        data: {
          fullName: `Cust${i}`, email: `cust${i}-${crypto.randomUUID().slice(0, 6)}@t.com`,
          password: '$2b$10$dummy', role: 'CUSTOMER', emailVerified: true,
        },
      });
      ids.push(u.id);
    }
    return ids;
  }

  test('seats accumulate across 3 different customers same slot (capacity=10)', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();
    const customers = await makeCustomers(3);

    // 3 customers × 2 guests each = 6 seats; capacity is 10
    for (const cid of customers) {
      await svc.createBooking(cid, {
        activityId: seed.activity.id,
        checkInDate: futureDate(7),
        slotTime: '10:00',
        guests: 2,
      bookingPhone: '+97455123456',
        idempotencyKey: crypto.randomUUID(),
      });
    }

    const sum = await ctx.prisma.booking.aggregate({
      where: { activityId: seed.activity.id, status: { in: ['PENDING', 'CONFIRMED'] } },
      _sum: { guests: true },
    });
    expect(sum._sum.guests).toBe(6);
  });

  test('over-capacity booking is rejected (10 seats used + request 3 more)', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();
    const customers = await makeCustomers(6);

    // Fill to capacity: 5 customers × 2 guests = 10 (capacity max)
    for (let i = 0; i < 5; i++) {
      await svc.createBooking(customers[i], {
        activityId: seed.activity.id,
        checkInDate: futureDate(7),
        slotTime: '10:00',
        guests: 2,
      bookingPhone: '+97455123456',
        idempotencyKey: crypto.randomUUID(),
      });
    }

    // 6th customer requests 3 more seats → reject (would be 13 > 10)
    await expect(
      svc.createBooking(customers[5], {
        activityId: seed.activity.id,
        checkInDate: futureDate(7),
        slotTime: '10:00',
        guests: 3,
      bookingPhone: '+97455123456',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow();
  });

  test('bookings on different dates do not interfere (capacity per-slot)', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();
    const customers = await makeCustomers(6);

    // Day 1: fill to capacity
    for (let i = 0; i < 5; i++) {
      await svc.createBooking(customers[i], {
        activityId: seed.activity.id,
        checkInDate: futureDate(7),
        slotTime: '10:00',
        guests: 2,
      bookingPhone: '+97455123456',
        idempotencyKey: crypto.randomUUID(),
      });
    }

    // Day 2: fresh start, first booking succeeds
    const day2 = await svc.createBooking(customers[5], {
      activityId: seed.activity.id,
      checkInDate: futureDate(8),
      slotTime: '10:00',
      guests: 5,
      bookingPhone: '+97455123456',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(day2.booking.status).toBe('PENDING');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Loyalty redemption
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.createBooking — loyalty redemption', () => {
  test('redeemPoints decrements user balance + writes ledger row', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();

    // Seed loyalty config + genesis balance (100,000 points available)
    await ctx.prisma.loyaltyConfig.upsert({
      where: { id: 'singleton' }, create: { id: 'singleton' }, update: {},
    });
    await ctx.prisma.user.update({
      where: { id: seed.customer.id },
      data: { loyaltyPoints: 100_000 },
    });
    await ctx.prisma.loyaltyLedger.create({
      data: {
        userId: seed.customer.id, delta: 100_000, balanceAfter: 100_000,
        source: 'ADMIN_ADJUST', actorType: 'SYSTEM', reason: 'genesis',
      },
    });

    // Redeem 5,000 points = 50 QAR off (qarPerPoint default 0.01)
    const res = await svc.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7),
      slotTime: '10:00',
      guests: 2,
      bookingPhone: '+97455123456',
      redeemPoints: 5_000,
      idempotencyKey: crypto.randomUUID(),
    });

    const b = await ctx.prisma.booking.findUniqueOrThrow({
      where: { id: res.booking.id },
    });
    expect(Number(b.pointsRedeemed)).toBe(5_000);
    expect(Number(b.pointsDiscount)).toBe(50);

    // User balance debited
    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: seed.customer.id },
    });
    expect(user.loyaltyPoints).toBe(95_000);

    // Ledger row with BOOKING_REDEEM source
    const redeemRow = await ctx.prisma.loyaltyLedger.findFirstOrThrow({
      where: { userId: seed.customer.id, source: 'BOOKING_REDEEM' },
    });
    expect(redeemRow.delta).toBe(-5_000);
    expect(redeemRow.bookingId).toBe(b.id);
  });

  test('insufficient points → whole tx rolls back (no booking, no payment, no debit)', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();

    await ctx.prisma.loyaltyConfig.upsert({
      where: { id: 'singleton' }, create: { id: 'singleton' }, update: {},
    });
    await ctx.prisma.user.update({
      where: { id: seed.customer.id },
      data: { loyaltyPoints: 100 }, // only 100 available
    });

    await expect(
      svc.createBooking(seed.customer.id, {
        activityId: seed.activity.id,
        checkInDate: futureDate(7),
        slotTime: '10:00',
        guests: 1,
      bookingPhone: '+97455123456',
        redeemPoints: 10_000, // way more than available
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow(/insufficient/i);

    // No booking
    expect(await ctx.prisma.booking.count()).toBe(0);
    // No payment
    expect(await ctx.prisma.payment.count()).toBe(0);
    // Balance untouched
    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: seed.customer.id },
    });
    expect(user.loyaltyPoints).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WANASA-only — payableAmount=0 → CONFIRMED, no PAY2M
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.createBooking — full points coverage (WANASA-only)', () => {
  test('redeem enough points to cover total → booking CONFIRMED with method=WANASA_POINTS', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();

    await ctx.prisma.loyaltyConfig.upsert({
      where: { id: 'singleton' }, create: { id: 'singleton' }, update: {},
    });
    // 1 guest × 100 + 5 service fee = 105 QAR → need 10,500 points
    await ctx.prisma.user.update({
      where: { id: seed.customer.id },
      data: { loyaltyPoints: 20_000 },
    });
    await ctx.prisma.loyaltyLedger.create({
      data: {
        userId: seed.customer.id, delta: 20_000, balanceAfter: 20_000,
        source: 'ADMIN_ADJUST', actorType: 'SYSTEM', reason: 'genesis',
      },
    });

    const res = await svc.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7),
      slotTime: '10:00',
      guests: 1,
      bookingPhone: '+97455123456',
      redeemPoints: 15_000, // more than 10,500 needed
      idempotencyKey: crypto.randomUUID(),
    });

    const b = await ctx.prisma.booking.findUniqueOrThrow({
      where: { id: res.booking.id },
      include: { payment: true },
    });
    // WANASA path → CONFIRMED immediately, no PAY2M hold
    expect(b.status).toBe('CONFIRMED');
    expect(b.payment!.method).toBe('WANASA_POINTS');
    expect(b.payment!.status).toBe('SUCCESS');
    expect(Number(b.payment!.amount)).toBe(0);
    expect(b.reservedUntil).toBeNull(); // no reservation — already booked
  });

  test('full-Wanasa booking enqueues VENDOR_BOOKING_NOTIFICATION outbox row for the owning vendor', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();

    await ctx.prisma.loyaltyConfig.upsert({
      where: { id: 'singleton' }, create: { id: 'singleton' }, update: {},
    });
    await ctx.prisma.user.update({
      where: { id: seed.customer.id }, data: { loyaltyPoints: 20_000 },
    });
    await ctx.prisma.loyaltyLedger.create({
      data: {
        userId: seed.customer.id, delta: 20_000, balanceAfter: 20_000,
        source: 'ADMIN_ADJUST', actorType: 'SYSTEM', reason: 'genesis',
      },
    });

    const res = await svc.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7),
      slotTime: '10:00',
      guests: 1,
      bookingPhone: '+97455199999',
      redeemPoints: 15_000,
      idempotencyKey: crypto.randomUUID(),
    });

    const rows = await ctx.prisma.emailOutbox.findMany({
      where: { bookingId: res.booking.id },
      orderBy: { createdAt: 'asc' },
    });
    const vendorRow = rows.find((r) => r.emailType === 'VENDOR_BOOKING_NOTIFICATION');
    expect(vendorRow).toBeDefined();
    expect(vendorRow!.recipient).toBe(seed.vendorUser.email);
    expect(vendorRow!.status).toBe('PENDING');

    const payload = vendorRow!.payload as Record<string, unknown>;
    expect(payload.bookingId).toBe(res.booking.id);
    expect(payload.vendorSlug).toBe(seed.vendor.slug);
    expect(payload.customerName).toBe(seed.customer.fullName);
    expect(payload.customerPhone).toBe('+97455199999');
    // PII discipline — customer email MUST NOT be in the payload.
    expect(JSON.stringify(payload)).not.toContain(seed.customer.email);
  });

  test('cross-vendor isolation — each booking enqueues to its OWN vendor only', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();

    // Second vendor + activity in the same country/city/category.
    const vendorUser2 = await ctx.prisma.user.create({
      data: {
        fullName: 'Other Vendor', email: 'vendor2@test.com',
        password: '$2b$10$dummy.hash.for.tests.never.used.in.auth',
        role: 'VENDOR', emailVerified: true,
      },
    });
    const vendor2 = await ctx.prisma.vendor.create({
      data: {
        userId: vendorUser2.id, businessNameEn: 'Other Biz', businessNameAr: 'تست2',
        businessId: 'BIZ-TEST-2', slug: 'other-biz',
        countryId: seed.country.id, status: 'ACTIVE',
      },
    });
    const activity2 = await ctx.prisma.activity.create({
      data: {
        vendorId: vendor2.id, categoryId: seed.category.id,
        countryId: seed.country.id, cityId: seed.city.id,
        titleEn: 'Other Tour', titleAr: 'جولة2',
        slug: 'other-tour-' + Math.random().toString(36).slice(2, 8),
        descriptionEn: 'desc', descriptionAr: 'وصف',
        locationAddress: 'Doha West Bay',
        locationLat: 25.32, locationLng: 51.52,
        bookingType: 'HOURLY', pricingModel: 'PER_PERSON',
        pricePerPerson: 100, capacity: 10,
        durationValue: 2, checkInTime: '09:00', checkOutTime: '21:00',
        coverImage: '/placeholder.webp', status: 'ACTIVE',
      },
    });

    await ctx.prisma.loyaltyConfig.upsert({
      where: { id: 'singleton' }, create: { id: 'singleton' }, update: {},
    });
    await ctx.prisma.user.update({
      where: { id: seed.customer.id }, data: { loyaltyPoints: 40_000 },
    });
    await ctx.prisma.loyaltyLedger.create({
      data: {
        userId: seed.customer.id, delta: 40_000, balanceAfter: 40_000,
        source: 'ADMIN_ADJUST', actorType: 'SYSTEM', reason: 'genesis',
      },
    });

    const r1 = await svc.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7), slotTime: '10:00', guests: 1,
      bookingPhone: '+97455100001', redeemPoints: 15_000,
      idempotencyKey: crypto.randomUUID(),
    });
    const r2 = await svc.createBooking(seed.customer.id, {
      activityId: activity2.id,
      checkInDate: futureDate(7), slotTime: '14:00', guests: 1,
      bookingPhone: '+97455100002', redeemPoints: 15_000,
      idempotencyKey: crypto.randomUUID(),
    });

    const allVendorRows = await ctx.prisma.emailOutbox.findMany({
      where: { emailType: 'VENDOR_BOOKING_NOTIFICATION' },
    });
    expect(allVendorRows).toHaveLength(2);

    const row1 = allVendorRows.find((r) => r.bookingId === r1.booking.id);
    const row2 = allVendorRows.find((r) => r.bookingId === r2.booking.id);
    expect(row1!.recipient).toBe(seed.vendorUser.email);
    expect(row2!.recipient).toBe(vendorUser2.email);
    // Belt-and-braces — never crossed wires.
    expect(row1!.recipient).not.toBe(vendorUser2.email);
    expect(row2!.recipient).not.toBe(seed.vendorUser.email);
  });

  test('soft-deleted vendor (email ends @deleted.local) → no vendor outbox row is created', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();

    // Soft-delete the vendor's user — anonymise email to the sentinel.
    await ctx.prisma.user.update({
      where: { id: seed.vendorUser.id },
      data: { email: `${seed.vendorUser.id}@deleted.local`, deletedAt: new Date() },
    });

    await ctx.prisma.loyaltyConfig.upsert({
      where: { id: 'singleton' }, create: { id: 'singleton' }, update: {},
    });
    await ctx.prisma.user.update({
      where: { id: seed.customer.id }, data: { loyaltyPoints: 20_000 },
    });
    await ctx.prisma.loyaltyLedger.create({
      data: {
        userId: seed.customer.id, delta: 20_000, balanceAfter: 20_000,
        source: 'ADMIN_ADJUST', actorType: 'SYSTEM', reason: 'genesis',
      },
    });

    const res = await svc.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7), slotTime: '10:00', guests: 1,
      bookingPhone: '+97455100099', redeemPoints: 15_000,
      idempotencyKey: crypto.randomUUID(),
    });

    const vendorRow = await ctx.prisma.emailOutbox.findFirst({
      where: { bookingId: res.booking.id, emailType: 'VENDOR_BOOKING_NOTIFICATION' },
    });
    expect(vendorRow).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Coupon application
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.createBooking — coupon', () => {
  test('valid vendor coupon (PERCENTAGE) applies discount + increments usedCount', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();

    const coupon = await ctx.prisma.coupon.create({
      data: {
        code: 'SAVE10',
        vendorId: seed.vendor.id,
        discountType: 'PERCENTAGE', discountValue: 10,
        validFrom: new Date('2020-01-01'),
        validTo:   new Date('2040-12-31'),
        usageLimit: 100, usedCount: 0,
        status: 'APPROVED',
      },
    });

    const res = await svc.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7),
      slotTime: '10:00',
      guests: 2,           // 200 QAR total
      couponCode: 'SAVE10', // 10% off → 20 QAR discount
      idempotencyKey: crypto.randomUUID(),
    });

    const b = await ctx.prisma.booking.findUniqueOrThrow({
      where: { id: res.booking.id },
    });
    expect(b.couponCode).toBe('SAVE10');
    expect(Number(b.couponDiscount)).toBe(20);

    // Usage count incremented
    const after = await ctx.prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
    expect(after.usedCount).toBe(1);
  });

  test('coupon past validTo → rejected (booking NOT created)', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();

    await ctx.prisma.coupon.create({
      data: {
        code: 'EXPIRED',
        vendorId: seed.vendor.id,
        discountType: 'PERCENTAGE', discountValue: 10,
        validFrom: new Date('2020-01-01'),
        validTo:   new Date('2020-06-30'), // expired
        status: 'APPROVED',
      },
    });

    await expect(
      svc.createBooking(seed.customer.id, {
        activityId: seed.activity.id,
        checkInDate: futureDate(7),
        slotTime: '10:00',
        guests: 2,
      bookingPhone: '+97455123456',
        couponCode: 'EXPIRED',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow();
    expect(await ctx.prisma.booking.count()).toBe(0);
  });

  test('coupon usageLimit reached → rejected', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();

    await ctx.prisma.coupon.create({
      data: {
        code: 'MAXED',
        vendorId: seed.vendor.id,
        discountType: 'PERCENTAGE', discountValue: 10,
        validFrom: new Date('2020-01-01'),
        validTo:   new Date('2040-12-31'),
        usageLimit: 1, usedCount: 1, // already maxed
        status: 'APPROVED',
      },
    });

    await expect(
      svc.createBooking(seed.customer.id, {
        activityId: seed.activity.id,
        checkInDate: futureDate(7),
        slotTime: '10:00',
        guests: 2,
      bookingPhone: '+97455123456',
        couponCode: 'MAXED',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow();
  });

  test('unknown coupon code → rejected', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();
    await expect(
      svc.createBooking(seed.customer.id, {
        activityId: seed.activity.id,
        checkInDate: futureDate(7),
        slotTime: '10:00',
        guests: 2,
      bookingPhone: '+97455123456',
        couponCode: 'GHOST',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// activeDays restriction
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.createBooking — activeDays restriction', () => {
  test('booking on a disallowed weekday → BadRequestException', async () => {
    const seed = await seedReference(ctx.prisma);

    // Restrict activity to MONDAY only
    await ctx.prisma.activity.update({
      where: { id: seed.activity.id },
      data: { activeDays: ['MONDAY'] },
    });

    // Find the next non-Monday date
    let candidate = new Date();
    candidate.setUTCDate(candidate.getUTCDate() + 7);
    while (candidate.getUTCDay() === 1) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
    }
    const nonMonday = candidate.toISOString().slice(0, 10);

    const { svc } = makeBookingsService();
    await expect(
      svc.createBooking(seed.customer.id, {
        activityId: seed.activity.id,
        checkInDate: nonMonday,
        slotTime: '10:00',
        guests: 1,
      bookingPhone: '+97455123456',
      }),
    ).rejects.toThrow(/not available on/i);
  });
});
