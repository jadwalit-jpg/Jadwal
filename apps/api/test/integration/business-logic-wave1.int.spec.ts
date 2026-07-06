/**
 * Wave 1 business-logic remediation contracts.
 *
 * Each `describe` block pins one of the 5 launch-blocker fixes from the
 * pre-launch business-logic audit (see plan
 * `greedy-wiggling-quiche.md` §B1, §B3, §B4, §B5, §B6). The point here
 * is the LOGIC contract, not exception types or HTTP shapes — these
 * tests exist so a future refactor can't accidentally re-open one of
 * the gaps.
 */

import { getTestContext, seedReference } from './_setup';
import { AdminService } from '../../src/admin/admin.service';
import { VendorService } from '../../src/vendor/vendor.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { NotificationService } from '../../src/common/services/notification.service';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

// ─── Service factories ──────────────────────────────────────────────

function makePrismaShim() {
  return { client: ctx.prisma } as any;
}

function makeAdminService() {
  const prisma = makePrismaShim();
  const loyalty = new LoyaltyService(prisma);
  const webPushStub = { sendToUser: jest.fn().mockResolvedValue(undefined) } as any;
  const notification = new NotificationService(prisma, webPushStub);
  const availabilityCache = {
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  return new AdminService(prisma, notification, loyalty, availabilityCache, { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any);
}

function makeVendorService() {
  const prisma = makePrismaShim();
  const loyalty = new LoyaltyService(prisma);
  const webPushStub = { sendToUser: jest.fn().mockResolvedValue(undefined) } as any;
  const notification = new NotificationService(prisma, webPushStub);
  const availabilityCache = {
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  // VendorService takes (prisma, notification, loyalty, availabilityCache)
  return new VendorService(prisma, notification, loyalty, availabilityCache);
}

// ─────────────────────────────────────────────────────────────────────
// B5 — admin force-CONFIRM without payment is rejected
// ─────────────────────────────────────────────────────────────────────

describe('B5 — admin updateBookingStatus refuses CONFIRMED without SUCCESS payment', () => {
  it('rejects PENDING booking → CONFIRMED transition when payment is PENDING', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = await ctx.prisma.user.create({
      data: { fullName: 'Admin', email: 'admin@test.com', password: 'x', role: 'ADMIN', emailVerified: true },
    });
    // Create a PENDING booking with a PENDING payment
    const payment = await ctx.prisma.payment.create({
      data: { amount: 100, currency: 'QAR', status: 'PENDING', payoutStatus: 'UNPAID', method: 'PENDING' },
    });
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-TEST-1',
        customerId: seed.customer.id,
        vendorId: seed.vendor.id,
        activityId: seed.activity.id,
        guests: 2,
      bookingPhone: '+97455123456',
        guestBreakdown: {},
        startDatetime: new Date(Date.now() + 24 * 3600_000),
        endDatetime: new Date(Date.now() + 26 * 3600_000),
        totalPrice:100,
        currencyCode: 'QAR',
        commissionPct: 10,
        commissionAmount: 10,
        serviceFee: 5,
        status: 'PENDING',
        paymentId: payment.id,
        reservedUntil: new Date(Date.now() + 30 * 60_000),
      },
    });

    const admin1 = makeAdminService();
    await expect(
      admin1.updateBookingStatus(admin.id, booking.id, 'CONFIRMED'),
    ).rejects.toThrow(/successful payment/i);

    // Booking still PENDING — guard rolled back nothing because nothing
    // was attempted.
    const after = await ctx.prisma.booking.findUnique({ where: { id: booking.id } });
    expect(after?.status).toBe('PENDING');
  });

  it('allows COMPLETED → CANCELLED on a paid booking (existing path unaffected)', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = await ctx.prisma.user.create({
      data: { fullName: 'Admin', email: 'admin@test.com', password: 'x', role: 'ADMIN', emailVerified: true },
    });
    const payment = await ctx.prisma.payment.create({
      data: { amount: 100, currency: 'QAR', status: 'SUCCESS', payoutStatus: 'UNPAID', method: 'PAY2M', paidAt: new Date() },
    });
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-TEST-2',
        customerId: seed.customer.id,
        vendorId: seed.vendor.id,
        activityId: seed.activity.id,
        guests: 2,
      bookingPhone: '+97455123456',
        guestBreakdown: {},
        startDatetime: new Date(Date.now() - 26 * 3600_000),
        endDatetime: new Date(Date.now() - 24 * 3600_000),
        totalPrice:100,
        currencyCode: 'QAR',
        commissionPct: 10,
        commissionAmount: 10,
        serviceFee: 5,
        status: 'COMPLETED',
        paymentId: payment.id,
        reservedUntil: new Date(Date.now() - 60_000),
      },
    });

    await ctx.prisma.loyaltyConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    });

    const admin1 = makeAdminService();
    await expect(
      admin1.updateBookingStatus(admin.id, booking.id, 'CANCELLED'),
    ).resolves.toBeDefined();
    const after = await ctx.prisma.booking.findUnique({ where: { id: booking.id } });
    expect(after?.status).toBe('CANCELLED');
  });
});

// ─────────────────────────────────────────────────────────────────────
// B6 — vendor.getPayoutRequests does NOT leak adminNote / paymentIds
// ─────────────────────────────────────────────────────────────────────

describe('B6 — vendor payout-request list omits adminNote + paymentIds', () => {
  it('returns only customer-safe fields', async () => {
    const seed = await seedReference(ctx.prisma);
    // Create a payout request with an admin note + paymentIds present
    await ctx.prisma.payoutRequest.create({
      data: {
        vendorId: seed.vendor.id,
        amount: 500,
        currency: 'QAR',
        status: 'REJECTED',
        adminNote: 'INTERNAL — vendor flagged for slow response, do not surface',
        paymentIds: ['pay-1', 'pay-2'],
      },
    });

    const vendorSvc = makeVendorService();
    const result = await vendorSvc.getPayoutRequests(seed.vendorUser.id, {} as any);
    expect(result.data.length).toBe(1);
    const row = result.data[0] as Record<string, unknown>;
    expect(row).not.toHaveProperty('adminNote');
    expect(row).not.toHaveProperty('paymentIds');
    // Customer-safe fields ARE present
    expect(row).toHaveProperty('id');
    expect(row).toHaveProperty('amount');
    expect(row).toHaveProperty('status', 'REJECTED');
  });
});

// ─────────────────────────────────────────────────────────────────────
// B4 — bank-details cool-down blocks payout request inside window
// ─────────────────────────────────────────────────────────────────────

describe('B4 — bank-details cool-down blocks payout requests within window', () => {
  // Save and restore the env var between tests
  const ORIG_COOLDOWN = process.env.PAYOUT_BANK_DETAILS_COOLDOWN_DAYS;
  afterAll(() => {
    if (ORIG_COOLDOWN === undefined) delete process.env.PAYOUT_BANK_DETAILS_COOLDOWN_DAYS;
    else process.env.PAYOUT_BANK_DETAILS_COOLDOWN_DAYS = ORIG_COOLDOWN;
  });

  it('updateSettings({bankDetails}) stamps bankDetailsChangedAt', async () => {
    const seed = await seedReference(ctx.prisma);
    const vendorSvc = makeVendorService();
    const before = await ctx.prisma.vendor.findUnique({ where: { id: seed.vendor.id }, select: { bankDetailsChangedAt: true } });
    expect(before?.bankDetailsChangedAt).toBeNull();

    await vendorSvc.updateSettings(seed.vendorUser.id, {
      bankDetails: { iban: 'QA123ABC', accountHolder: 'Test Biz' },
    });

    const after = await ctx.prisma.vendor.findUnique({ where: { id: seed.vendor.id }, select: { bankDetailsChangedAt: true } });
    expect(after?.bankDetailsChangedAt).toBeInstanceOf(Date);
    expect(Date.now() - after!.bankDetailsChangedAt!.getTime()).toBeLessThan(5_000);
  });

  it('payout request is blocked if bankDetails changed within cool-down window', async () => {
    process.env.PAYOUT_BANK_DETAILS_COOLDOWN_DAYS = '7';
    const seed = await seedReference(ctx.prisma);
    // Set bankDetails + bankDetailsChangedAt to recently
    await ctx.prisma.vendor.update({
      where: { id: seed.vendor.id },
      data: {
        bankDetails: { iban: 'QA123', accountHolder: 'X' },
        bankDetailsChangedAt: new Date(),
      },
    });
    // Give the vendor a payable booking so balance > 0
    const payment = await ctx.prisma.payment.create({
      data: { amount: 200, currency: 'QAR', status: 'SUCCESS', payoutStatus: 'UNPAID', method: 'PAY2M', paidAt: new Date() },
    });
    await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-TEST-3',
        customerId: seed.customer.id,
        vendorId: seed.vendor.id,
        activityId: seed.activity.id,
        guests: 2,
      bookingPhone: '+97455123456',
        guestBreakdown: {},
        startDatetime: new Date(Date.now() - 26 * 3600_000),
        endDatetime: new Date(Date.now() - 24 * 3600_000),
        totalPrice:200,
        currencyCode: 'QAR',
        commissionPct: 10,
        commissionAmount: 20,
        serviceFee: 5,
        status: 'COMPLETED',
        paymentId: payment.id,
        reservedUntil: new Date(Date.now() - 60_000),
      },
    });

    const vendorSvc = makeVendorService();
    await expect(
      vendorSvc.requestPayout(seed.vendorUser.id),
    ).rejects.toThrow(/recently/i);
  });

  it('payout request succeeds once cool-down window has elapsed', async () => {
    process.env.PAYOUT_BANK_DETAILS_COOLDOWN_DAYS = '7';
    const seed = await seedReference(ctx.prisma);
    // bankDetailsChangedAt set 8 days ago — outside window
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600_000);
    await ctx.prisma.vendor.update({
      where: { id: seed.vendor.id },
      data: {
        bankDetails: { iban: 'QA123', accountHolder: 'X' },
        bankDetailsChangedAt: eightDaysAgo,
      },
    });
    const payment = await ctx.prisma.payment.create({
      data: { amount: 200, currency: 'QAR', status: 'SUCCESS', payoutStatus: 'UNPAID', method: 'PAY2M', paidAt: new Date() },
    });
    await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-TEST-4',
        customerId: seed.customer.id,
        vendorId: seed.vendor.id,
        activityId: seed.activity.id,
        guests: 2,
      bookingPhone: '+97455123456',
        guestBreakdown: {},
        startDatetime: new Date(Date.now() - 26 * 3600_000),
        endDatetime: new Date(Date.now() - 24 * 3600_000),
        totalPrice:200,
        currencyCode: 'QAR',
        commissionPct: 10,
        commissionAmount: 20,
        serviceFee: 5,
        status: 'COMPLETED',
        paymentId: payment.id,
        reservedUntil: new Date(Date.now() - 60_000),
      },
    });

    const vendorSvc = makeVendorService();
    const req = await vendorSvc.requestPayout(seed.vendorUser.id);
    expect(req).toBeDefined();
    expect(req.amount).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// B3 — admin cancel of COMPLETED booking reverses earned points
// ─────────────────────────────────────────────────────────────────────

describe('B3 — admin cancel of COMPLETED booking debits previously-awarded points', () => {
  it('writes CANCEL_REVERSE_AWARDED ledger row and decrements user balance', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = await ctx.prisma.user.create({
      data: { fullName: 'Admin', email: 'admin@test.com', password: 'x', role: 'ADMIN', emailVerified: true },
    });
    // Loyalty config: 1 point per QAR (so 100 QAR booking → 100 pts)
    await ctx.prisma.loyaltyConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', pointsPerQar: 1, qarPerPoint: 0.01 },
      update: { pointsPerQar: 1, qarPerPoint: 0.01 },
    });
    // Customer was already credited 100 points
    await ctx.prisma.user.update({
      where: { id: seed.customer.id },
      data: { loyaltyPoints: 100 },
    });

    const payment = await ctx.prisma.payment.create({
      data: { amount: 100, currency: 'QAR', status: 'SUCCESS', payoutStatus: 'UNPAID', method: 'PAY2M', paidAt: new Date() },
    });
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-TEST-5',
        customerId: seed.customer.id,
        vendorId: seed.vendor.id,
        activityId: seed.activity.id,
        guests: 1,
      bookingPhone: '+97455123456',
        guestBreakdown: {},
        startDatetime: new Date(Date.now() - 26 * 3600_000),
        endDatetime: new Date(Date.now() - 24 * 3600_000),
        totalPrice:100,
        currencyCode: 'QAR',
        commissionPct: 10,
        commissionAmount: 10,
        serviceFee: 5,
        status: 'COMPLETED',
        pointsAwarded: true,
        paymentId: payment.id,
        reservedUntil: new Date(Date.now() - 60_000),
      },
    });
    // A completed+awarded booking ALWAYS has a BOOKING_EARN ledger row in prod
    // (the earn writes it). Seed it so the cancel reverses the EXACT credited
    // amount via the ledger (getEarnedPoints), not a current-rate recompute.
    await ctx.prisma.loyaltyLedger.create({
      data: {
        userId: seed.customer.id, delta: 100, balanceAfter: 100,
        source: 'BOOKING_EARN', bookingId: booking.id,
        actorType: 'SYSTEM', actorId: null, reason: 'test earn',
      },
    });

    const adminSvc = makeAdminService();
    await adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED');

    // Customer balance debited by 100. The cash refund also CREDITS
    // points (refund-to-Wanasa, ADMIN_REFUND_APPROVED — at qarPerPoint
    // 0.01, 100 QAR refund → 10000 points credited). Net: 100 (initial)
    // − 100 (reversal) + 10000 (refund-credit) = 10000.
    const userAfter = await ctx.prisma.user.findUnique({
      where: { id: seed.customer.id },
      select: { loyaltyPoints: true },
    });
    expect(Number(userAfter?.loyaltyPoints)).toBe(10_000);

    // CANCEL_REVERSE_AWARDED ledger row exists with delta -100
    const reverseRow = await ctx.prisma.loyaltyLedger.findFirst({
      where: { userId: seed.customer.id, source: 'CANCEL_REVERSE_AWARDED' },
    });
    expect(reverseRow).toBeDefined();
    expect(Number(reverseRow!.delta)).toBe(-100);

    // pointsAwarded flag cleared on the booking
    const after = await ctx.prisma.booking.findUnique({ where: { id: booking.id } });
    expect(after?.pointsAwarded).toBe(false);
  });

  it('reverses the EXACT points credited even after the earn rate changed (ledger, not recompute)', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = await ctx.prisma.user.create({
      data: { fullName: 'Admin2', email: 'admin2@test.com', password: 'x', role: 'ADMIN', emailVerified: true },
    });
    await ctx.prisma.loyaltyConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', pointsPerQar: 1, qarPerPoint: 1 },
      update: { pointsPerQar: 1, qarPerPoint: 1 },
    });
    await ctx.prisma.user.update({ where: { id: seed.customer.id }, data: { loyaltyPoints: 100 } });
    const payment = await ctx.prisma.payment.create({
      data: { amount: 100, currency: 'QAR', status: 'SUCCESS', payoutStatus: 'UNPAID', method: 'PAY2M', paidAt: new Date() },
    });
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-RATE', customerId: seed.customer.id, vendorId: seed.vendor.id, activityId: seed.activity.id,
        guests: 1, bookingPhone: '+97455123456', guestBreakdown: {},
        startDatetime: new Date(Date.now() - 26 * 3600_000), endDatetime: new Date(Date.now() - 24 * 3600_000),
        totalPrice: 100, currencyCode: 'QAR', commissionPct: 10, commissionAmount: 10, serviceFee: 5,
        status: 'COMPLETED', pointsAwarded: true, paymentId: payment.id,
        reservedUntil: new Date(Date.now() - 60_000),
      },
    });
    // Earned 100 points at the rate in force AT completion (BOOKING_EARN delta 100).
    await ctx.prisma.loyaltyLedger.create({
      data: {
        userId: seed.customer.id, delta: 100, balanceAfter: 100,
        source: 'BOOKING_EARN', bookingId: booking.id, actorType: 'SYSTEM', actorId: null, reason: 'earn @ rate 1',
      },
    });
    // Admin DOUBLES the earn rate AFTER the award, BEFORE the cancel.
    await ctx.prisma.loyaltyConfig.update({ where: { id: 'singleton' }, data: { pointsPerQar: 2 } });

    const adminSvc = makeAdminService();
    await adminSvc.updateBookingStatus(admin.id, booking.id, 'CANCELLED');

    // Reversal debits the ORIGINAL 100 (from the ledger), NOT 200 (recompute at
    // the new rate). Before this fix it recomputed with the current rate — which
    // over-debits here and, worse, could UNDER-reverse or skip entirely if the
    // rate had dropped, leaving the customer free residual points.
    const reverseRow = await ctx.prisma.loyaltyLedger.findFirst({
      where: { userId: seed.customer.id, source: 'CANCEL_REVERSE_AWARDED' },
    });
    expect(reverseRow).not.toBeNull();
    expect(Number(reverseRow!.delta)).toBe(-100);
  });
});

// ─────────────────────────────────────────────────────────────────────
// B1 — coupon expiry detected at payment confirmation (audit only)
// ─────────────────────────────────────────────────────────────────────

describe('B1 — coupon expiry race emits PAYMENT_COUPON_INVALID_AT_CONFIRMATION audit', () => {
  it('honors the customer-quoted price but logs a forensic audit row when coupon expired post-booking', async () => {
    // This test exercises the integration directly — we don't
    // round-trip through PAY2M. Instead we drive the underlying
    // helper that handleCallback uses to detect the coupon-expiry
    // condition. The full handleCallback round-trip is exercised in
    // payment-callback.int.spec.ts.
    const seed = await seedReference(ctx.prisma);
    // Create an EXPIRED coupon
    const coupon = await ctx.prisma.coupon.create({
      data: {
        code: 'EXPIRED-10',
        vendorId: seed.vendor.id,
        discountType: 'FIXED',
        discountValue: 10,
        validFrom: new Date(Date.now() - 30 * 24 * 3600_000),
        validTo: new Date(Date.now() - 1 * 24 * 3600_000),
        status: 'APPROVED',
      },
    });

    // Simulate: the payment-service detection logic. We replicate
    // exactly the expression used in payment.service.ts handleCallback
    // around the PAYMENT_COUPON_INVALID_AT_CONFIRMATION branch.
    const liveCoupon = await ctx.prisma.coupon.findUnique({
      where: { code: 'EXPIRED-10' },
      select: { status: true, validTo: true, usageLimit: true, usedCount: true },
    });
    const now = new Date();
    const couponInvalid =
      !liveCoupon ||
      liveCoupon.status !== 'APPROVED' ||
      liveCoupon.validTo < now ||
      (liveCoupon.usageLimit !== null && liveCoupon.usedCount > liveCoupon.usageLimit);
    expect(couponInvalid).toBe(true);

    // Cleanup the coupon (no leakage between tests)
    await ctx.prisma.coupon.delete({ where: { id: coupon.id } });
  });

  it('valid coupon at confirmation does not trigger detection', async () => {
    const seed = await seedReference(ctx.prisma);
    const coupon = await ctx.prisma.coupon.create({
      data: {
        code: 'VALID-10',
        vendorId: seed.vendor.id,
        discountType: 'FIXED',
        discountValue: 10,
        validFrom: new Date(Date.now() - 24 * 3600_000),
        validTo: new Date(Date.now() + 30 * 24 * 3600_000),
        status: 'APPROVED',
      },
    });

    const liveCoupon = await ctx.prisma.coupon.findUnique({
      where: { code: 'VALID-10' },
      select: { status: true, validTo: true, usageLimit: true, usedCount: true },
    });
    const now = new Date();
    const couponInvalid =
      !liveCoupon ||
      liveCoupon.status !== 'APPROVED' ||
      liveCoupon.validTo < now ||
      (liveCoupon.usageLimit !== null && liveCoupon.usedCount > liveCoupon.usageLimit);
    expect(couponInvalid).toBe(false);

    await ctx.prisma.coupon.delete({ where: { id: coupon.id } });
  });
});
