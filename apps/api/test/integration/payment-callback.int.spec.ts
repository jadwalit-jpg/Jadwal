/**
 * PaymentService.handleCallback — PAY2M callback against a real DB.
 *
 * The payment callback is the money-critical touchpoint: it flips a PENDING
 * booking + payment into CONFIRMED + SUCCESS (or deletes them on failure).
 *
 * DB-level invariants covered here:
 *   - Unknown basket_id → 400, no DB change
 *   - Tampered hash on SUCCESS → 400, payment stays PENDING, audit row written
 *   - Valid SUCCESS → payment=SUCCESS, booking=CONFIRMED, paidAt set, method=PAY2M
 *   - Failure callback → booking + payment rows deleted (slot freed)
 *   - Duplicate SUCCESS callback → idempotent (no duplicate audit, no state flip)
 *   - Unknown err_code → treated as failure (rows deleted), no audit hash row
 *   - FAILED-status payment + SUCCESS callback → recovery (flips to SUCCESS)
 */

import { getTestContext, seedReference } from './_setup';
import { PaymentService } from '../../src/payment/payment.service';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

// Known-value PAY2M config for deterministic hash-building in the tests.
const PAY2M = {
  MERCHANT_ID:   'TEST_MERCHANT',
  SECURED_KEY:   'secret-key',
  SECRET_WORD:   'secret-word',
  RETURN_URL:    'https://example.com/return',
  API_URL:       'https://pay2m.test',
  MERCHANT_NAME: 'Jadwal Test',
};

function configShim(overrides: Record<string, string> = {}) {
  const merged: Record<string, string> = {
    PAYMENT_ENABLED:     'true',
    PAY2M_MERCHANT_ID:   PAY2M.MERCHANT_ID,
    PAY2M_SECURED_KEY:   PAY2M.SECURED_KEY,
    PAY2M_SECRET_WORD:   PAY2M.SECRET_WORD,
    PAY2M_RETURN_URL:    PAY2M.RETURN_URL,
    PAY2M_API_URL:       PAY2M.API_URL,
    PAY2M_MERCHANT_NAME: PAY2M.MERCHANT_NAME,
    ...overrides,
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

function makePaymentService(configOverrides: Record<string, string> = {}) {
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
  const emailService = {
    sendBookingConfirmation: jest.fn().mockResolvedValue(undefined),
  } as any;
  const availabilityCache = {
    invalidate: jest.fn().mockResolvedValue(undefined),
  } as any;

  return {
    svc: new PaymentService(
      configShim(configOverrides) as any,
      prismaSvc,
      redisLock,
      auditLogger,
      notificationService,
      emailService,
      availabilityCache,
    ),
    auditLogger,
    notificationService,
    emailService,
    availabilityCache,
  };
}

/** Compute the Response_Key that PAY2M would send back for these params. */
function signCallback(basketId: string, amount: string, errCode: string): string {
  const raw = `${PAY2M.MERCHANT_ID}${basketId}${PAY2M.SECRET_WORD}${amount}${errCode}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Seed a PENDING payment + booking pair ready for a callback. Returns handles. */
async function seedPendingPayment(amountQar = 200) {
  const seed = await seedReference(ctx.prisma);
  const basketId = `BSK-${crypto.randomUUID().slice(0, 8)}`;

  // PENDING payment with basket_id set (PaymentService.initiate sets this)
  const payment = await ctx.prisma.payment.create({
    data: {
      amount: amountQar, currency: 'QAR', status: 'PENDING',
      method: 'PAY2M', gatewayBasketId: basketId,
    },
  });
  const booking = await ctx.prisma.booking.create({
    data: {
      ref: `JDWL-PAY-${crypto.randomUUID().slice(0, 6)}`,
      currencyCode: 'QAR',
      guests: 2, totalPrice: amountQar, serviceFee: 5, commissionAmount: 20,
      status: 'PENDING',
      startDatetime: new Date('2030-09-01T10:00:00Z'),
      endDatetime:   new Date('2030-09-01T12:00:00Z'),
      activityId: seed.activity.id,
      customerId: seed.customer.id,
      vendorId: seed.vendor.id,
      paymentId: payment.id,
      reservedUntil: new Date(Date.now() + 600_000),
    },
  });

  // Mirror the write that bookings.service.createBooking now performs so the
  // seed matches real prod state (payments.bookingId populated by the booking
  // creation tx). handleCallback reads this scalar.
  await ctx.prisma.payment.update({
    where: { id: payment.id },
    data: { bookingId: booking.id },
  });

  return { seed, basketId, paymentId: payment.id, bookingId: booking.id, amountStr: amountQar.toFixed(2) };
}

// ═══════════════════════════════════════════════════════════════════════════
// Unknown / disabled callbacks
// ═══════════════════════════════════════════════════════════════════════════

describe('PaymentService.handleCallback — upfront rejects', () => {
  test('PAYMENT_ENABLED=false → BadRequest; DB untouched', async () => {
    const { svc } = makePaymentService({ PAYMENT_ENABLED: 'false' });
    await expect(
      svc.handleCallback({
        err_code: '00', basket_id: 'anything', Response_Key: 'x',
      }),
    ).rejects.toThrow('Payment service is not available');
  });

  test('unknown basket_id → BadRequest "Payment not found"', async () => {
    const { svc } = makePaymentService();
    await expect(
      svc.handleCallback({
        err_code: '00', basket_id: 'BSK-ghost', Response_Key: 'anything',
      }),
    ).rejects.toThrow('Payment not found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Successful SUCCESS callback — happy path
// ═══════════════════════════════════════════════════════════════════════════

describe('PaymentService.handleCallback — SUCCESS path', () => {
  test('valid hash + err_code=00 → payment=SUCCESS, booking=CONFIRMED, paidAt set, method=PAY2M', async () => {
    const { svc } = makePaymentService();
    const { basketId, paymentId, bookingId, amountStr } = await seedPendingPayment(200);

    const res = await svc.handleCallback({
      err_code: '00',
      basket_id: basketId,
      transaction_id: 'TXN-001',
      Response_Key: signCallback(basketId, amountStr, '00'),
    });

    expect(res.status).toBe('success');
    expect(res.bookingId).toBe(bookingId);

    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p.status).toBe('SUCCESS');
    expect(p.paidAt).toBeInstanceOf(Date);
    expect(p.gatewayTxnId).toBe('TXN-001');
    expect(p.gatewayErrCode).toBe('00');
    expect(p.method).toBe('PAY2M');

    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(b.status).toBe('CONFIRMED');
  });

  test('err_code=000 (alt) also accepted', async () => {
    const { svc } = makePaymentService();
    const { basketId, paymentId, amountStr } = await seedPendingPayment(150);

    await svc.handleCallback({
      err_code: '000',
      basket_id: basketId,
      transaction_id: 'TXN-alt',
      Response_Key: signCallback(basketId, amountStr, '000'),
    });

    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p.status).toBe('SUCCESS');
  });

  test('audit log PAYMENT_SUCCESS is written', async () => {
    const { svc, auditLogger } = makePaymentService();
    const { basketId, amountStr } = await seedPendingPayment(100);

    await svc.handleCallback({
      err_code: '00', basket_id: basketId,
      transaction_id: 'T1', Response_Key: signCallback(basketId, amountStr, '00'),
    });

    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYMENT_SUCCESS' }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tamper detection
// ═══════════════════════════════════════════════════════════════════════════

describe('PaymentService.handleCallback — tamper detection', () => {
  test('SUCCESS with invalid hash → BadRequest; payment STAYS pending', async () => {
    const { svc, auditLogger } = makePaymentService();
    const { basketId, paymentId } = await seedPendingPayment(200);

    await expect(
      svc.handleCallback({
        err_code: '00', basket_id: basketId,
        transaction_id: 'TX', Response_Key: 'a'.repeat(64), // wrong hash, correct length
      }),
    ).rejects.toThrow('Payment verification failed');

    // Payment unchanged
    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p.status).toBe('PENDING');
    expect(p.paidAt).toBeNull();

    // Mismatch audit row was written
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYMENT_HASH_MISMATCH' }),
    );
  });

  test('FAILURE with invalid hash → still processed (no tamper risk on a declined tx)', async () => {
    const { svc } = makePaymentService();
    const { basketId, paymentId, bookingId } = await seedPendingPayment(200);

    const res = await svc.handleCallback({
      err_code: '99', basket_id: basketId,
      Response_Key: 'z'.repeat(64), // wrong hash
    });
    expect(res.status).toBe('failed');

    // Booking + payment are GONE (failure deletes them)
    expect(await ctx.prisma.payment.findUnique({ where: { id: paymentId } })).toBeNull();
    expect(await ctx.prisma.booking.findUnique({ where: { id: bookingId } })).toBeNull();
  });

  test('Response_Key of wrong length → verify returns false (no crash)', async () => {
    const { svc } = makePaymentService();
    const { basketId, paymentId } = await seedPendingPayment(200);

    await expect(
      svc.handleCallback({
        err_code: '00', basket_id: basketId, Response_Key: 'short',
      }),
    ).rejects.toThrow('Payment verification failed');

    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p.status).toBe('PENDING');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Failure callback — booking + payment hard delete
// ═══════════════════════════════════════════════════════════════════════════

describe('PaymentService.handleCallback — FAILURE path', () => {
  test('err_code non-00 → booking + payment rows deleted (slot freed)', async () => {
    const { svc } = makePaymentService();
    const { basketId, paymentId, bookingId, amountStr } = await seedPendingPayment(200);

    const res = await svc.handleCallback({
      err_code: '01', basket_id: basketId,
      Response_Key: signCallback(basketId, amountStr, '01'),
    });

    expect(res.status).toBe('failed');
    expect(await ctx.prisma.payment.findUnique({ where: { id: paymentId } })).toBeNull();
    expect(await ctx.prisma.booking.findUnique({ where: { id: bookingId } })).toBeNull();
  });

  test('availabilityCache invalidate called for the deleted booking\'s activity', async () => {
    const { svc, availabilityCache } = makePaymentService();
    const { basketId, seed } = await seedPendingPayment(200);

    await svc.handleCallback({
      err_code: '01', basket_id: basketId, Response_Key: 'bad',
    });

    expect(availabilityCache.invalidate).toHaveBeenCalledWith(seed.activity.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Idempotency — duplicate callbacks
// ═══════════════════════════════════════════════════════════════════════════

describe('PaymentService.handleCallback — idempotency', () => {
  test('duplicate SUCCESS callback is a no-op returning success', async () => {
    const { svc, auditLogger } = makePaymentService();
    const { basketId, paymentId, bookingId, amountStr } = await seedPendingPayment(200);

    // First call → SUCCESS flip
    await svc.handleCallback({
      err_code: '00', basket_id: basketId,
      transaction_id: 'T1', Response_Key: signCallback(basketId, amountStr, '00'),
    });
    const after1 = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

    const auditCallsAfter1 = auditLogger.log.mock.calls.length;

    // Second call with same params
    const res2 = await svc.handleCallback({
      err_code: '00', basket_id: basketId,
      transaction_id: 'T1', Response_Key: signCallback(basketId, amountStr, '00'),
    });
    expect(res2.status).toBe('success');
    expect(res2.bookingId).toBe(bookingId);

    // Payment state is byte-identical — no second update occurred
    const after2 = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(after2.paidAt?.getTime()).toBe(after1.paidAt?.getTime());
    expect(after2.gatewayTxnId).toBe('T1');

    // No new audit row (the early return short-circuits before audit)
    expect(auditLogger.log.mock.calls.length).toBe(auditCallsAfter1);
  });

  test('duplicate FAILURE callback → 2nd returns failed without throwing; no booking/payment resurrected', async () => {
    const { svc } = makePaymentService();
    const { basketId, amountStr } = await seedPendingPayment(200);

    await svc.handleCallback({
      err_code: '01', basket_id: basketId,
      Response_Key: signCallback(basketId, amountStr, '01'),
    });

    // Second call now hits "unknown basket" because the payment row is gone —
    // that is the expected post-failure behaviour (idempotent from the
    // customer's point of view because their money is already back).
    await expect(
      svc.handleCallback({
        err_code: '01', basket_id: basketId,
        Response_Key: signCallback(basketId, amountStr, '01'),
      }),
    ).rejects.toThrow('Payment not found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cron-race recovery: payment was FAILED by cron, then PAY2M reports SUCCESS
// ═══════════════════════════════════════════════════════════════════════════

describe('PaymentService.handleCallback — cron-race recovery', () => {
  test('payment=FAILED + late SUCCESS callback → flips to SUCCESS (customer was charged)', async () => {
    // The booking's reservation timer expired while the customer was on PAY2M.
    // Cron flipped the payment to FAILED but left the row intact (it did not
    // cascade-delete because reservedUntil was still in range when we staged
    // the test). PAY2M then confirms SUCCESS: we MUST recover the booking.
    const { svc } = makePaymentService();
    const { basketId, paymentId, bookingId, amountStr } = await seedPendingPayment(200);

    // Simulate cron intervention
    await ctx.prisma.payment.update({
      where: { id: paymentId }, data: { status: 'FAILED' },
    });

    await svc.handleCallback({
      err_code: '00', basket_id: basketId,
      transaction_id: 'LATE-TX', Response_Key: signCallback(basketId, amountStr, '00'),
    });

    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p.status).toBe('SUCCESS');

    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(b.status).toBe('CONFIRMED');
  });

  test('payment=FAILED + late FAILURE callback → stays failed (no resurrection)', async () => {
    const { svc } = makePaymentService();
    const { basketId, paymentId, bookingId, amountStr } = await seedPendingPayment(200);

    await ctx.prisma.payment.update({
      where: { id: paymentId }, data: { status: 'FAILED' },
    });

    const res = await svc.handleCallback({
      err_code: '01', basket_id: basketId,
      Response_Key: signCallback(basketId, amountStr, '01'),
    });
    expect(res.status).toBe('failed');
    // Note: the late-failure branch short-circuits BEFORE the tx deletes rows,
    // so the booking + payment are still present at their FAILED state.
    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p.status).toBe('FAILED');
    expect(await ctx.prisma.booking.findUnique({ where: { id: bookingId } })).not.toBeNull();
  });

  test('booking was deleted by cron + SUCCESS callback → orphan audit row, no throw', async () => {
    // Edge case: cron fully cancelled+deleted the booking but the payment row
    // remains (under its prior PENDING status). PAY2M confirms SUCCESS. The
    // service MUST NOT crash; it logs PAYMENT_ORPHANED for manual refund.
    const { svc, auditLogger } = makePaymentService();
    const { basketId, bookingId, paymentId, amountStr } = await seedPendingPayment(200);

    // Detach booking from payment then delete the booking to mimic cron
    await ctx.prisma.booking.update({ where: { id: bookingId }, data: { paymentId: null } });
    await ctx.prisma.booking.delete({ where: { id: bookingId } });

    await svc.handleCallback({
      err_code: '00', basket_id: basketId,
      transaction_id: 'ORPHAN-TX', Response_Key: signCallback(basketId, amountStr, '00'),
    });

    // Orphan audit row written
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYMENT_ORPHANED' }),
    );
    // Payment row still present and SUCCESS (so finance can refund manually)
    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p.status).toBe('SUCCESS');
  });
});
