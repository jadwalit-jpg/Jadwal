/**
 * PaymentService.initiatePayment — R3 idempotency key, against a real DB.
 *
 * Mirrors the Booking.idempotencyKey contract (see booking-create.int.spec.ts):
 *   - Same key + same user + same booking → second call returns idempotent:true,
 *     exactly one Payment row, the gatewayBasketId is re-used (not regenerated).
 *   - Same key reused for a DIFFERENT booking of the same user → 409.
 *   - No key → no dedupe; works normally; the column stays NULL.
 *
 * The PAY2M token HTTP call (getAccessToken) is stubbed — this exercises the
 * DB-side idempotency invariants, not the gateway handoff.
 */

import { getTestContext, seedReference } from './_setup';
import { PaymentService } from '../../src/payment/payment.service';
import { ConflictException } from '@nestjs/common';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function configShim() {
  const merged: Record<string, string> = {
    PAYMENT_ENABLED:     'true',
    PAY2M_MERCHANT_ID:   'TEST_MERCHANT',
    PAY2M_SECURED_KEY:   'secret-key',
    PAY2M_SECRET_WORD:   'secret-word',
    PAY2M_RETURN_URL:    'https://example.com/return',
    PAY2M_API_URL:       'https://pay2m.test',
    PAY2M_MERCHANT_NAME: 'Jadwal Test',
  };
  return {
    get: (k: string, fallback?: string) => merged[k] ?? fallback,
    getOrThrow: <T,>(k: string): T => {
      const v = merged[k];
      if (v === undefined) throw new Error(`Missing config: ${k}`);
      return v as any;
    },
  };
}

function makePaymentService() {
  const prismaSvc = { client: ctx.prisma } as any;
  const redisLock = {
    acquire: jest.fn().mockResolvedValue('lock-token'),
    release: jest.fn().mockResolvedValue(undefined),
  } as any;
  const auditLogger = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const notificationService = {
    send: jest.fn().mockResolvedValue(undefined),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
  } as any;
  const emailService = { sendBookingConfirmation: jest.fn().mockResolvedValue(undefined) } as any;
  const availabilityCache = { invalidate: jest.fn().mockResolvedValue(undefined) } as any;
  const loyalty = {
    refund: jest.fn().mockResolvedValue(undefined),
    redeem: jest.fn().mockResolvedValue(undefined),
    reverseAwarded: jest.fn().mockResolvedValue(undefined),
  } as any;

  const svc = new PaymentService(
    configShim() as any,
    prismaSvc,
    redisLock,
    auditLogger,
    notificationService,
    emailService,
    availabilityCache,
    loyalty,
  );
  // initiatePayment hands off to PAY2M via getAccessToken() — stub the HTTP call.
  jest.spyOn(svc as any, 'getAccessToken').mockResolvedValue('test-access-token');
  return { svc, auditLogger };
}

/** Seed a PENDING booking + linked PENDING payment for `customerId`. */
async function seedPendingBooking(
  customerId: string,
  activityId: string,
  vendorId: string,
  bookingPhone = '+97455123456',
) {
  const payment = await ctx.prisma.payment.create({
    data: { amount: 200, currency: 'QAR', status: 'PENDING', method: 'PAY2M' },
  });
  const booking = await ctx.prisma.booking.create({
    data: {
      ref: `JDWL-INIT-${crypto.randomUUID().slice(0, 6)}`,
      currencyCode: 'QAR', guests: 2, totalPrice: 200, serviceFee: 5, commissionAmount: 20,
      bookingPhone,
      // initiatePayment refuses unverified bookings (email-OTP gate), so the
      // seeded booking must be marked email-verified.
      emailOtpVerifiedAt: new Date(),
      status: 'PENDING',
      startDatetime: new Date('2030-10-01T10:00:00Z'),
      endDatetime:   new Date('2030-10-01T12:00:00Z'),
      activityId, customerId, vendorId,
      paymentId: payment.id,
      reservedUntil: new Date(Date.now() + 600_000),
    },
  });
  await ctx.prisma.payment.update({ where: { id: payment.id }, data: { bookingId: booking.id } });
  return { paymentId: payment.id, bookingId: booking.id };
}

describe('PaymentService.initiatePayment — R3 idempotency', () => {
  test('same key + same user + same booking → idempotent:true, one Payment, basket re-used', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makePaymentService();
    const { paymentId, bookingId } = await seedPendingBooking(seed.customer.id, seed.activity.id, seed.vendor.id);
    const key = crypto.randomUUID();

    const first = await svc.initiatePayment(bookingId, seed.customer.id, key);
    expect(first.idempotent).toBe(false);
    const p1 = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p1.idempotencyKey).toBe(key);
    expect(p1.gatewayBasketId).toMatch(/^JDWL-/);

    const second = await svc.initiatePayment(bookingId, seed.customer.id, key);
    expect(second.idempotent).toBe(true);
    const p2 = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p2.gatewayBasketId).toBe(p1.gatewayBasketId); // re-used, not regenerated
    // No second payment was spun up. Scope the count to this scenario's key so
    // it stays robust if a shared fixture ever seeds unrelated payment rows.
    expect(await ctx.prisma.payment.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  test('same key reused for a DIFFERENT booking of the same user → 409', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makePaymentService();
    const a = await seedPendingBooking(seed.customer.id, seed.activity.id, seed.vendor.id);
    const b = await seedPendingBooking(seed.customer.id, seed.activity.id, seed.vendor.id);
    const key = crypto.randomUUID();

    await svc.initiatePayment(a.bookingId, seed.customer.id, key);
    await expect(svc.initiatePayment(b.bookingId, seed.customer.id, key)).rejects.toBeInstanceOf(ConflictException);
  });

  test('no key → works, idempotent:false, key column stays NULL', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makePaymentService();
    const { paymentId, bookingId } = await seedPendingBooking(seed.customer.id, seed.activity.id, seed.vendor.id);

    const res = await svc.initiatePayment(bookingId, seed.customer.id);
    expect(res.idempotent).toBe(false);
    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p.idempotencyKey).toBeNull();
  });

  test('PAY2M form CUSTOMER_MOBILE_NO uses booking.bookingPhone, not User.phone', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makePaymentService();

    // Force the account-level phone to be NULL on the seeded customer so that
    // booking.bookingPhone is the only viable source for the mandatory PAY2M
    // CUSTOMER_MOBILE_NO field. This mirrors the post-PR#264 reality where
    // User.phone is optional but the per-booking phone is required.
    await ctx.prisma.user.update({
      where: { id: seed.customer.id },
      data: { phone: null },
    });

    const { bookingId } = await seedPendingBooking(
      seed.customer.id, seed.activity.id, seed.vendor.id,
      '+97455999888',  // explicit per-booking phone that must show up in the form
    );

    const res = await svc.initiatePayment(bookingId, seed.customer.id);
    expect(res.formFields.CUSTOMER_MOBILE_NO).toBe('+97455999888');
  });
});
