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
  // Faithful SET NX PX semantics: first acquire of a key wins (returns a token),
  // a second acquire of a still-held key returns null. This matters for the
  // duplicate-capture dedup, which relies on an atomic Redis marker.
  const heldLocks = new Set<string>();
  const redisLock = {
    acquire: jest.fn(async (key: string) => {
      if (heldLocks.has(key)) return null;
      heldLocks.add(key);
      return 'lock-token';
    }),
    release: jest.fn(async (key: string) => { heldLocks.delete(key); }),
  } as any;
  // Persist to the real auditLog table (as the production AuditLoggerService does
  // — it awaits the create) AND record the call, so tests can both count calls and
  // exercise code that READS audit rows back (e.g. the duplicate-capture dedup).
  const auditLogger = {
    log: jest.fn(async (p: any) => {
      await ctx.prisma.auditLog.create({
        data: {
          actorType: p.actorType, actorId: p.actorId, actorName: p.actorName,
          action: p.action, entity: p.entity, entityId: p.entityId ?? null,
          details: p.details ?? null, actionCategory: p.actionCategory ?? 'OPERATIONAL',
        },
      });
    }),
  } as any;
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
  const loyalty = {
    refund: jest.fn().mockResolvedValue(undefined),
    redeem: jest.fn().mockResolvedValue(undefined),
    reverseAwarded: jest.fn().mockResolvedValue(undefined),
    // Pure function (no DB) — mirror the real LoyaltyService formula so the
    // booking-confirmation email's projected-points value is computed correctly.
    computeEarnedPoints: jest.fn((total: number, discount: number, rate: number) =>
      rate <= 0 ? 0 : Math.round(Math.max(0, total - discount) * rate * 100) / 100,
    ),
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
      loyalty,
    ),
    loyalty,
    auditLogger,
    notificationService,
    emailService,
    availabilityCache,
  };
}

/**
 * Compute the Response_Key that PAY2M would send back for these params.
 * Recipe (PAY2M Merchant Integration Guide, Table 1.2):
 * SHA256(merchant_id + basket_id + secret_word + amount + err_code).
 */
function signCallback(basketId: string, amount: string, errCode: string): string {
  const raw = `${PAY2M.MERCHANT_ID}${basketId}${PAY2M.SECRET_WORD}${amount}${errCode}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * NAPS/QPay rail Response_Key — the SWAPPED order (err_code + amount), as
 * proven from live production recipeMatch diagnostics (2026-06-10): NAPS signs
 * SHA256(merchant_id + basket_id + secret_word + err_code + amount) with the
 * gateway code "00" and the integer amount form, while echoing "001" in the
 * visible err_code field.
 */
function signCallbackNaps(basketId: string, amount: string, errCode: string): string {
  const raw = `${PAY2M.MERCHANT_ID}${basketId}${PAY2M.SECRET_WORD}${errCode}${amount}`;
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
      guests: 2, bookingPhone: '+97455123456', totalPrice: amountQar, serviceFee: 5, commissionAmount: 20,
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
// R4 — booking-confirmation email goes to the outbox, not a fire-and-forget send
// ═══════════════════════════════════════════════════════════════════════════

describe('PaymentService.handleCallback — email outbox (R4)', () => {
  test('SUCCESS enqueues the customer + vendor PENDING email_outbox rows with the booking payload', async () => {
    const { svc, emailService } = makePaymentService();
    const { basketId, bookingId, amountStr } = await seedPendingPayment(200);

    await svc.handleCallback({
      err_code: '00', basket_id: basketId,
      transaction_id: 'TXN-OUTBOX', Response_Key: signCallback(basketId, amountStr, '00'),
    });

    // No direct SES send on the hot path anymore — the worker owns it.
    expect(emailService.sendBookingConfirmation).not.toHaveBeenCalled();

    // SUCCESS enqueues TWO PENDING emails — the customer BOOKING_CONFIRMATION
    // and the VENDOR_BOOKING_NOTIFICATION (both delivered later by the worker).
    const rows = await ctx.prisma.emailOutbox.findMany({ where: { bookingId } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'PENDING')).toBe(true);
    expect(rows.map((r) => r.emailType).sort()).toEqual([
      'BOOKING_CONFIRMATION',
      'VENDOR_BOOKING_NOTIFICATION',
    ]);
    const row = rows.find((r) => r.emailType === 'BOOKING_CONFIRMATION')!;
    expect(row.attempts).toBe(0);
    const payload = row.payload as Record<string, unknown>;
    expect(payload.bookingId).toBe(bookingId);
    expect(payload.currency).toBe('QAR');
    // Regression: customer email "Total" must equal payment.amount (the amount
    // PAY2M actually charged), NOT a recomputed `totalPrice + serviceFee -
    // couponDiscount` — that formula double-subtracted the coupon because
    // booking.totalPrice is already post-coupon. amountStr is `amountQar.toFixed(2)`
    // == payment.amount.toFixed(2) for this seed.
    expect(payload.totalAmount).toBe(amountStr);
  });

  test('SUCCESS with a coupon-applied booking → email Total equals payment.amount (not the pre-fix double-subtracted value)', async () => {
    const { svc } = makePaymentService();
    // Build a booking where the pre-fix formula and the corrected formula
    // diverge: totalPrice already post-coupon (80), couponDiscount=20,
    // serviceFee=5 → pre-fix would compute 80+5-20=65; payment.amount=85
    // (the actual charged amount). The fix reads payment.amount directly.
    const seed = await seedReference(ctx.prisma);
    const basketId = `BSK-COUP-${crypto.randomUUID().slice(0, 8)}`;
    const payment = await ctx.prisma.payment.create({
      data: {
        amount: 85, currency: 'QAR', status: 'PENDING',
        method: 'PAY2M', gatewayBasketId: basketId,
      },
    });
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-COUP-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR',
        guests: 1, bookingPhone: '+97455123456',
        totalPrice: 80,            // already post-coupon
        serviceFee: 5,
        couponCode: 'SAVE20',
        couponDiscount: 20,
        commissionAmount: 8,
        status: 'PENDING',
        startDatetime: new Date('2030-09-02T10:00:00Z'),
        endDatetime:   new Date('2030-09-02T12:00:00Z'),
        activityId: seed.activity.id,
        customerId: seed.customer.id,
        vendorId: seed.vendor.id,
        paymentId: payment.id,
        reservedUntil: new Date(Date.now() + 600_000),
      },
    });
    await ctx.prisma.payment.update({ where: { id: payment.id }, data: { bookingId: booking.id } });

    await svc.handleCallback({
      err_code: '00', basket_id: basketId,
      transaction_id: 'TXN-COUP',
      Response_Key: signCallback(basketId, (85).toFixed(2), '00'),
    });

    const rows = await ctx.prisma.emailOutbox.findMany({
      where: { bookingId: booking.id, emailType: 'BOOKING_CONFIRMATION' },
    });
    expect(rows).toHaveLength(1);
    const payload = rows[0].payload as Record<string, unknown>;
    expect(payload.totalAmount).toBe('85.00');
    // Belt-and-braces: the buggy pre-fix value MUST NOT appear.
    expect(payload.totalAmount).not.toBe('65.00');
  });

  test('FAILURE callback enqueues nothing (booking is deleted)', async () => {
    const { svc } = makePaymentService();
    const { basketId, amountStr } = await seedPendingPayment(150);

    await svc.handleCallback({
      err_code: '99', basket_id: basketId,
      Response_Key: signCallback(basketId, amountStr, '99'),
    });

    expect(await ctx.prisma.emailOutbox.count()).toBe(0);
  });

  test('FAILURE callback REFUNDS a coupon-applied booking (usedCount--, status restored, claim freed)', async () => {
    const { svc } = makePaymentService();
    const { seed, basketId, bookingId, amountStr } = await seedPendingPayment(120);
    // The state createBooking leaves for a single-use voucher it consumed:
    // usedCount at the cap, auto-EXPIRED, claim marked used.
    const voucher = await ctx.prisma.coupon.create({
      data: {
        code: `FAILREF-${crypto.randomUUID().slice(0, 6)}`, vendorId: null,
        discountType: 'PERCENTAGE', discountValue: 10,
        validFrom: new Date('2020-01-01T00:00:00Z'), validTo: new Date('2035-01-01T00:00:00Z'),
        usageLimit: 1, usedCount: 1, status: 'EXPIRED',
      },
    });
    const claim = await ctx.prisma.claimedCoupon.create({ data: { userId: seed.customer.id, couponId: voucher.id, used: true } });
    await ctx.prisma.booking.update({ where: { id: bookingId }, data: { couponCode: voucher.code } });

    // PAY2M reports failure → booking torn down → the coupon must be returned.
    await svc.handleCallback({
      err_code: '99', basket_id: basketId,
      Response_Key: signCallback(basketId, amountStr, '99'),
    });

    const after = await ctx.prisma.coupon.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(after.usedCount).toBe(0);
    expect(after.status).toBe('APPROVED'); // restored — voucher back in the customer's wallet
    expect((await ctx.prisma.claimedCoupon.findUniqueOrThrow({ where: { id: claim.id } })).used).toBe(false);
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

  test('FAILURE with invalid hash → REJECTED (closes forge-failure-IPN attack)', async () => {
    // Updated 2026-05-02 to match the security-audit hardening from
    // PR #80 (commit 6518b87). Previously the hash check was lenient
    // on failure-coded callbacks ("there's no money at risk if it's
    // declined anyway"), but that left a forge-failure-IPN attack
    // vector: an attacker who knew a victim's basket_id could send a
    // forged FAILED callback to mark the victim's PENDING booking as
    // FAILED → cron deletes it → spot freed/lost. Now ALL callbacks
    // require a valid hash regardless of err_code; the booking +
    // payment stay PENDING so the legitimate gateway IPN can still
    // arrive and complete.
    const { svc } = makePaymentService();
    const { basketId, paymentId, bookingId } = await seedPendingPayment(200);

    await expect(
      svc.handleCallback({
        err_code: '99', basket_id: basketId,
        Response_Key: 'z'.repeat(64), // wrong hash
      }),
    ).rejects.toThrow('Payment verification failed');

    // Booking + payment intact — bad hash never gets to mutate state
    expect(await ctx.prisma.payment.findUnique({ where: { id: paymentId } })).not.toBeNull();
    expect(await ctx.prisma.booking.findUnique({ where: { id: bookingId } })).not.toBeNull();
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
  test('err_code non-00 → booking deleted (slot freed), payment KEPT as FAILED', async () => {
    const { svc } = makePaymentService();
    const { basketId, paymentId, bookingId, amountStr } = await seedPendingPayment(200);

    const res = await svc.handleCallback({
      err_code: '01', basket_id: basketId,
      Response_Key: signCallback(basketId, amountStr, '01'),
    });

    expect(res.status).toBe('failed');

    // The unpaid booking is removed so the slot is freed.
    expect(await ctx.prisma.booking.findUnique({ where: { id: bookingId } })).toBeNull();

    // But the payment row is NOT hard-deleted (was the H2 bug). It is flipped to
    // FAILED and retained: (1) the codebase invariant is "payments are never
    // hard-deleted" (7-year FINANCIAL retention); (2) keeping gatewayBasketId +
    // bookingSnapshot is what lets §B2 orphan-recovery re-create the booking or
    // queue a refund if PAY2M later reports a genuine capture for this basket
    // (browser callbacks can carry non-terminal codes like 002/001).
    const kept = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    expect(kept).not.toBeNull();
    expect(kept!.status).toBe('FAILED');
    expect(kept!.gatewayBasketId).toBe(basketId); // recovery anchor preserved
  });

  test('availabilityCache invalidate called for the deleted booking\'s activity', async () => {
    // Updated 2026-05-02 — must use a VALID hash now that all callbacks
    // (including failures) require hash verification per PR #80.
    const { svc, availabilityCache } = makePaymentService();
    const { basketId, seed, amountStr } = await seedPendingPayment(200);

    await svc.handleCallback({
      err_code: '01',
      basket_id: basketId,
      Response_Key: signCallback(basketId, amountStr, '01'),
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

  test('duplicate FAILURE callback → 2nd returns failed idempotently; no booking resurrected', async () => {
    const { svc } = makePaymentService();
    const { basketId, paymentId, bookingId, amountStr } = await seedPendingPayment(200);

    await svc.handleCallback({
      err_code: '01', basket_id: basketId,
      Response_Key: signCallback(basketId, amountStr, '01'),
    });

    // The payment row is now KEPT as FAILED (H2 fix) rather than hard-deleted, so
    // the second callback no longer throws "Payment not found". It finds the
    // FAILED row, the `updateMany WHERE status:'PENDING'` matches nothing, and it
    // returns a clean idempotent "failed" — a strictly better outcome than the old
    // throw, and the booking is NOT resurrected.
    const res2 = await svc.handleCallback({
      err_code: '01', basket_id: basketId,
      Response_Key: signCallback(basketId, amountStr, '01'),
    });
    expect(res2.status).toBe('failed');

    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('FAILED');
    expect(await ctx.prisma.booking.findUnique({ where: { id: bookingId } })).toBeNull();
  });

  test('SECOND CAPTURE (different txn id on an already-SUCCESS payment) → flagged, not swallowed', async () => {
    const { svc, auditLogger, notificationService } = makePaymentService();
    const { basketId, paymentId, amountStr } = await seedPendingPayment(200);

    // First capture → SUCCESS, records txn 'CAP-1'.
    await svc.handleCallback({
      err_code: '00', basket_id: basketId,
      transaction_id: 'CAP-1', Response_Key: signCallback(basketId, amountStr, '00'),
    });
    const auditsAfterFirst = auditLogger.log.mock.calls.length;

    // A REPLAY of the same capture (same txn id) must stay a silent no-op.
    await svc.handleCallback({
      err_code: '00', basket_id: basketId,
      transaction_id: 'CAP-1', Response_Key: signCallback(basketId, amountStr, '00'),
    });
    expect(auditLogger.log.mock.calls.length).toBe(auditsAfterFirst); // no new audit

    // Only the duplicate-capture ALERT is the concern here; the normal success flow
    // may notify admins for its own reasons, so we assert on DELTAS not absolutes.
    const dupAudits = () =>
      auditLogger.log.mock.calls.map((c: any[]) => c[0]).filter((a: any) => a.action === 'PAYMENT_DUPLICATE_CAPTURE');
    const dupNotifies = () =>
      (notificationService.notifyAdmins as jest.Mock).mock.calls.filter((c: any[]) => /duplicate charge/i.test(c[0]?.title ?? ''));

    // An UNSIGNED second capture (forged/garbage Response_Key) must NOT raise an
    // alarm — the duplicate-charge alert fires only for an AUTHENTICATED success,
    // otherwise anyone hitting /payment/callback could spam admins.
    await svc.handleCallback({
      err_code: '00', basket_id: basketId,
      transaction_id: 'FORGED', Response_Key: 'deadbeef'.repeat(8), // wrong hash
    });
    expect(dupAudits()).toHaveLength(0);
    expect(dupNotifies()).toHaveLength(0);

    // A genuine SECOND CAPTURE (DIFFERENT, correctly-signed txn) is the
    // duplicate-charge case — recorded FINANCIAL + paged to admin, not discarded.
    const res = await svc.handleCallback({
      err_code: '00', basket_id: basketId,
      transaction_id: 'CAP-2', Response_Key: signCallback(basketId, amountStr, '00'),
    });
    expect(res.status).toBe('success'); // still idempotent to the gateway

    expect(dupAudits()).toHaveLength(1);
    expect(dupAudits()[0].actionCategory).toBe('FINANCIAL');
    expect(dupAudits()[0].entityId).toBe(paymentId);
    expect(dupNotifies()).toHaveLength(1);

    // REPLAY of the same second capture (CAP-2 again). The admin PAGE is deduped
    // (atomic Redis marker) — admins are paged exactly ONCE. The FINANCIAL audit
    // row, however, is written unconditionally each time BY DESIGN: durability of
    // the authoritative record must not hinge on a best-effort marker, so a
    // duplicate (harmless, append-only) row is the deliberate trade. (PAY2M can
    // re-deliver; a browser redirect can be re-hit.)
    await svc.handleCallback({
      err_code: '00', basket_id: basketId,
      transaction_id: 'CAP-2', Response_Key: signCallback(basketId, amountStr, '00'),
    });
    expect(dupNotifies()).toHaveLength(1); // page deduped — still ONE (the guarantee that matters)
    expect(dupAudits()).toHaveLength(2); // audit written every time — durable, not gated on the marker

    // The recorded capture is unchanged — we never overwrite CAP-1 with CAP-2.
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).gatewayTxnId).toBe('CAP-1');
  });

  test('CONCURRENT second capture (loser of the confirm race) → still flagged', async () => {
    // The dangerous case: two captures arrive so close that BOTH read PENDING at
    // entry. The winner confirms (records CAP-1); the loser's confirm updateMany
    // matches 0 rows (already SUCCESS) and returns success through the optimistic-
    // lock-loss path — WITHOUT re-entering the entry-SUCCESS branch. Without the
    // loss-path detection this genuine double charge is silently dropped.
    //
    // We drive the loser deterministically: force ONLY the entry read (by basket
    // id) to report PENDING, while the real row is already SUCCESS with CAP-1 —
    // exactly the state the loser observes.
    const { svc, auditLogger, notificationService } = makePaymentService();
    const { basketId, paymentId, amountStr } = await seedPendingPayment(200);

    // Winner confirms first.
    await svc.handleCallback({
      err_code: '00', basket_id: basketId, transaction_id: 'CAP-1',
      Response_Key: signCallback(basketId, amountStr, '00'),
    });

    const realFindUnique = ctx.prisma.payment.findUnique.bind(ctx.prisma.payment);
    const spy = (jest.spyOn(ctx.prisma.payment, 'findUnique') as any).mockImplementation(async (args: any) => {
      const row = await realFindUnique(args);
      // Only the entry lookup (by gatewayBasketId) sees the stale PENDING; the
      // by-id refetch + the helper's re-read see the true SUCCESS + CAP-1.
      if (args?.where?.gatewayBasketId && row) return { ...row, status: 'PENDING' };
      return row;
    });

    let res;
    try {
      res = await svc.handleCallback({
        err_code: '00', basket_id: basketId, transaction_id: 'CAP-2-CONCURRENT',
        Response_Key: signCallback(basketId, amountStr, '00'),
      });
    } finally {
      spy.mockRestore();
    }

    expect(res!.status).toBe('success'); // idempotent to the gateway

    const dup = auditLogger.log.mock.calls
      .map((c: any[]) => c[0])
      .filter((a: any) => a.action === 'PAYMENT_DUPLICATE_CAPTURE' && /CAP-2-CONCURRENT/.test(a.details ?? ''));
    expect(dup).toHaveLength(1); // the loser flagged the duplicate
    expect(dup[0].actionCategory).toBe('FINANCIAL');
    expect(
      (notificationService.notifyAdmins as jest.Mock).mock.calls.filter((c: any[]) => /duplicate charge/i.test(c[0]?.title ?? '')),
    ).toHaveLength(1);
    // Winner's txn preserved.
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).gatewayTxnId).toBe('CAP-1');
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

  test('booking was deleted by cron + SUCCESS callback (no snapshot) → REFUND_PENDING + audit', async () => {
    // Edge case: cron fully cancelled+deleted the booking but the payment row
    // remains under its prior PENDING status with NO bookingSnapshot (legacy
    // pre-§B2 row, or one created via a path that didn't stamp the snapshot).
    // §B2 contract: with no snapshot to recreate from, the recovery path
    // queues a refund and emits PAYMENT_RECOVERY_REFUND_QUEUED. Payment
    // flips to REFUND_PENDING (NOT SUCCESS — we cannot keep money for a
    // booking we can't recreate). When a snapshot IS present, the recovery
    // re-inserts the booking; that path is covered by the wave3 spec.
    const { svc, auditLogger } = makePaymentService();
    const { basketId, bookingId, paymentId, amountStr } = await seedPendingPayment(200);

    // Detach booking from payment then delete the booking to mimic cron
    await ctx.prisma.booking.update({ where: { id: bookingId }, data: { paymentId: null } });
    await ctx.prisma.booking.delete({ where: { id: bookingId } });

    await svc.handleCallback({
      err_code: '00', basket_id: basketId,
      transaction_id: 'ORPHAN-TX', Response_Key: signCallback(basketId, amountStr, '00'),
    });

    // Refund queued via the §B2 fallback path
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PAYMENT_RECOVERY_REFUND_QUEUED',
        actionCategory: 'FINANCIAL',
      }),
    );
    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p.status).toBe('REFUND_PENDING');
    expect(p.refundAmount?.toString()).toBe('200');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NAPS/QPay rail — rail-aware hold semantics against a real DB
//
// A verified NAPS success is authentic but capture-ambiguous (the rail can
// sign "00" pre-capture — live basket 939bd325 booked with no money — AND
// post-capture — Apple Pay/Fawran captures lost their bookings when rejected).
// So: NAPS success → HOLD (payment+booking stay PENDING, reservation extended,
// audited, status 'pending'); NAPS failure → normal cleanup; card → unchanged.
// ═══════════════════════════════════════════════════════════════════════════

describe('PaymentService.handleCallback — NAPS rail (err+amount order)', () => {
  test('verified NAPS success → HELD: stays PENDING, reservation extended, audited, 0 outbox, nothing deleted', async () => {
    const { svc, auditLogger, availabilityCache } = makePaymentService();
    const { basketId, paymentId, bookingId } = await seedPendingPayment(200);
    const before = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { reservedUntil: true } });

    // Real NAPS shape: visible err_code "001", hash signed err "00" + INTEGER amount.
    const res = await svc.handleCallback({
      err_code: '001', basket_id: basketId, transaction_id: 'TXN-NAPS-HELD',
      Response_Key: signCallbackNaps(basketId, '200', '00'),
    });

    expect(res.status).toBe('pending');
    expect(res.bookingId).toBe(bookingId);

    // Money-state untouched: neither confirmed (no money proof) nor deleted (money may be real).
    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p.status).toBe('PENDING');
    expect(p.paidAt).toBeNull();
    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(b.status).toBe('PENDING');

    // Reservation extended forward (seed gives +10 min; hold extends to ~+30 min).
    expect(b.reservedUntil!.getTime()).toBeGreaterThan(before.reservedUntil!.getTime());
    expect(b.reservedUntil!.getTime()).toBeGreaterThan(Date.now() + 20 * 60_000);

    // No success side-effects fired.
    expect(await ctx.prisma.emailOutbox.findMany({ where: { bookingId } })).toHaveLength(0);
    expect(availabilityCache.invalidate).not.toHaveBeenCalled();

    // Forensic trail: held-awaiting-capture, not success/failure.
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYMENT_NAPS_AWAITING_CAPTURE', actionCategory: 'FINANCIAL' }),
    );
  });

  test('duplicate NAPS success callbacks → idempotent holds (still PENDING, never confirmed)', async () => {
    const { svc } = makePaymentService();
    const { basketId, paymentId } = await seedPendingPayment(200);

    const key = signCallbackNaps(basketId, '200', '00');
    await svc.handleCallback({ err_code: '001', basket_id: basketId, Response_Key: key });
    const res2 = await svc.handleCallback({ err_code: '001', basket_id: basketId, Response_Key: key });

    expect(res2.status).toBe('pending');
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('PENDING');
  });

  test('verified NAPS FAILURE (901 customer-cancel) → booking deleted, payment KEPT as FAILED, slot freed', async () => {
    const { svc, availabilityCache } = makePaymentService();
    const { basketId, paymentId, bookingId, seed } = await seedPendingPayment(200);

    const res = await svc.handleCallback({
      err_code: '901', basket_id: basketId,
      Response_Key: signCallbackNaps(basketId, '200', '901'),
    });

    expect(res.status).toBe('failed');
    // Booking gone (slot freed); payment retained as FAILED (never hard-deleted).
    expect(await ctx.prisma.booking.findUnique({ where: { id: bookingId } })).toBeNull();
    const kept = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    expect(kept).not.toBeNull();
    expect(kept!.status).toBe('FAILED');
    expect(availabilityCache.invalidate).toHaveBeenCalledWith(seed.activity.id);
  });

  test('cron-FAILED payment + late NAPS success → held as pending, payment stays FAILED (no capture-ambiguous recovery)', async () => {
    const { svc, auditLogger } = makePaymentService();
    const { basketId, paymentId } = await seedPendingPayment(200);
    await ctx.prisma.payment.update({ where: { id: paymentId }, data: { status: 'FAILED' } });

    const res = await svc.handleCallback({
      err_code: '001', basket_id: basketId,
      Response_Key: signCallbackNaps(basketId, '200', '00'),
    });

    expect(res.status).toBe('pending');
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('FAILED');
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYMENT_NAPS_AWAITING_CAPTURE' }),
    );
  });

  test('SECURITY: forged NAPS-shaped callback (wrong key) still rejected; nothing held or deleted', async () => {
    const { svc } = makePaymentService();
    const { basketId, paymentId, bookingId } = await seedPendingPayment(200);

    await expect(svc.handleCallback({
      err_code: '001', basket_id: basketId, Response_Key: 'a'.repeat(64),
    })).rejects.toThrow(/verification failed/i);

    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('PENDING');
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe('PENDING');
  });

  test('SECURITY: NAPS-order signature for the WRONG amount does not verify (amount tamper)', async () => {
    const { svc } = makePaymentService();
    const { basketId } = await seedPendingPayment(200);

    // Signed for 1 QAR but the payment is 200 QAR — must not pass on any form/order.
    await expect(svc.handleCallback({
      err_code: '001', basket_id: basketId, Response_Key: signCallbackNaps(basketId, '1', '00'),
    })).rejects.toThrow(/verification failed/i);
  });

  test('card SUCCESS regression: amount+err order still confirms exactly as before', async () => {
    const { svc } = makePaymentService();
    const { basketId, paymentId, bookingId, amountStr } = await seedPendingPayment(150);

    const res = await svc.handleCallback({
      err_code: '00', basket_id: basketId, transaction_id: 'TXN-CARD-REG',
      Response_Key: signCallback(basketId, amountStr, '00'),
    });

    expect(res.status).toBe('success');
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('SUCCESS');
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe('CONFIRMED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// IPN capture confirmation — the server-to-server push is the authoritative
// "captured" signal for NAPS (browser callback is hash-unverifiable: no amount).
// Trust = allow-listed source IP (NOT the hash). These prove: a trusted success
// books; an UNTRUSTED IPN can neither confirm nor fail (anti-forgery); a trusted
// failure marks failed (no booking); retries are idempotent; the charged amount
// is always the server-frozen payment.amount (the IPN carries none).
// ═══════════════════════════════════════════════════════════════════════════

const IPN_CFG = { PAY2M_IPN_CONFIRM_ENABLED: 'true', PAY2M_IPN_ALLOWED_IPS: '34.18.115.33' };

describe('PaymentService — IPN capture confirmation', () => {
  test('trusted SUCCESS IPN (err_code 0000) → booking CONFIRMED, amount = server value', async () => {
    const { basketId, paymentId, bookingId, amountStr } = await seedPendingPayment(200);
    const { svc } = makePaymentService(IPN_CFG);
    const res = await svc.handleCallback(
      { err_code: '0000', basket_id: basketId, transaction_id: 'TXN-IPN-1', Response_Key: '' },
      { via: 'ipn', trustedCapture: true },
    );
    expect(res.status).toBe('success');
    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p.status).toBe('SUCCESS');
    expect(Number(p.amount).toFixed(2)).toBe(amountStr); // unchanged — IPN has no amount
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe('CONFIRMED');
  });

  test('UNTRUSTED IPN success → NO confirm (anti-forgery): payment + booking stay PENDING', async () => {
    const { basketId, paymentId, bookingId } = await seedPendingPayment(200);
    const { svc } = makePaymentService(IPN_CFG);
    const res = await svc.handleCallback(
      { err_code: '0000', basket_id: basketId, transaction_id: 'TXN-FORGED', Response_Key: '' },
      { via: 'ipn', trustedCapture: false },
    );
    expect(res.status).toBe('pending');
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('PENDING');
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe('PENDING');
  });

  test('UNTRUSTED IPN failure → does NOT fail a legit pending payment (forged-failure guard)', async () => {
    const { basketId, paymentId } = await seedPendingPayment(200);
    const { svc } = makePaymentService(IPN_CFG);
    await svc.handleCallback(
      { err_code: '90', basket_id: basketId, transaction_id: 'TXN-FORGED-FAIL', Response_Key: '' },
      { via: 'ipn', trustedCapture: false },
    );
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('PENDING');
  });

  test('trusted NON-success IPN (err_code 90) → NO destructive action (stays PENDING; callback+cron handle declines)', async () => {
    const { basketId, paymentId, bookingId } = await seedPendingPayment(200);
    const { svc } = makePaymentService(IPN_CFG);
    const res = await svc.handleCallback(
      { err_code: '90', basket_id: basketId, transaction_id: 'TXN-FAIL', Response_Key: '' },
      { via: 'ipn', trustedCapture: true },
    );
    // We never FAIL from an IPN (unknown code taxonomy) — leave it PENDING so a
    // payment PAY2M may still capture is never prematurely failed.
    expect(res.status).toBe('pending');
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('PENDING');
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe('PENDING');
  });

  test('duplicate trusted success IPN → idempotent (stays SUCCESS, no error)', async () => {
    const { basketId, paymentId } = await seedPendingPayment(200);
    const { svc } = makePaymentService(IPN_CFG);
    await svc.handleCallback({ err_code: '0000', basket_id: basketId, transaction_id: 'TXN-A', Response_Key: '' }, { via: 'ipn', trustedCapture: true });
    const res2 = await svc.handleCallback({ err_code: '0000', basket_id: basketId, transaction_id: 'TXN-A', Response_Key: '' }, { via: 'ipn', trustedCapture: true });
    expect(res2.status).toBe('success');
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('SUCCESS');
  });
});

describe('PaymentService.isTrustedIpnSource — fail-closed', () => {
  test('feature OFF → never trusted, even an allow-listed IP', async () => {
    const { svc } = makePaymentService({ PAY2M_IPN_CONFIRM_ENABLED: 'false', PAY2M_IPN_ALLOWED_IPS: '34.18.115.33' });
    expect(svc.isTrustedIpnSource('34.18.115.33')).toBe(false);
  });
  test('feature ON + IP in allow-list → trusted', async () => {
    const { svc } = makePaymentService(IPN_CFG);
    expect(svc.isTrustedIpnSource('34.18.115.33')).toBe(true);
  });
  test('feature ON + IP NOT in allow-list → not trusted', async () => {
    const { svc } = makePaymentService(IPN_CFG);
    expect(svc.isTrustedIpnSource('1.2.3.4')).toBe(false);
    expect(svc.isTrustedIpnSource(undefined)).toBe(false);
  });
  test('empty allow-list → trusts nothing (fail-closed)', async () => {
    const { svc } = makePaymentService({ PAY2M_IPN_CONFIRM_ENABLED: 'true', PAY2M_IPN_ALLOWED_IPS: '' });
    expect(svc.isTrustedIpnSource('34.18.115.33')).toBe(false);
  });
});
