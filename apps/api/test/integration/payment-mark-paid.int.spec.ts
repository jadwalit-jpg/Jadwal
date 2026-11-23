/**
 * Gateway rescue against a real DB — PaymentService.confirmPaymentManually
 * ("Mark as paid"), the rescue markers the callback stamps, the once-only
 * admin alert, and the held-payment watch.
 *
 * Context: debit-card (NAPS) callbacks that PAY2M reports as successful can
 * fail the site's hash check (Nov 2026) or be held awaiting an IPN. The admin
 * confirms such a payment by hand with the PAY2M transaction id and a note.
 * The booking may still be PENDING, be CANCELLED by the customer (who gave up
 * after the failed callback), or be gone (reaped by the cleanup cron, snapshot
 * on the payment). A slot taken in the meantime refuses with 409 and no change.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import * as crypto from 'crypto';
import { getTestContext, seedReference } from './_setup';
import { PaymentService } from '../../src/payment/payment.service';
import { GatewayWatchService, HELD_ALERT_AFTER_MS } from '../../src/payment/gateway-watch.service';
import { AdminService } from '../../src/admin/admin.service';
import { buildBookingSnapshot } from '../../src/bookings/bookings.service';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

const PAY2M = {
  MERCHANT_ID: 'TEST_MERCHANT', SECURED_KEY: 'secret-key', SECRET_WORD: 'secret-word',
  RETURN_URL: 'https://example.com/return', API_URL: 'https://pay2m.test', MERCHANT_NAME: 'Jadwal Test',
};

function configShim() {
  const merged: Record<string, string> = {
    PAYMENT_ENABLED: 'true', PAY2M_MERCHANT_ID: PAY2M.MERCHANT_ID, PAY2M_SECURED_KEY: PAY2M.SECURED_KEY,
    PAY2M_SECRET_WORD: PAY2M.SECRET_WORD, PAY2M_RETURN_URL: PAY2M.RETURN_URL, PAY2M_API_URL: PAY2M.API_URL,
    PAY2M_MERCHANT_NAME: PAY2M.MERCHANT_NAME,
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

function makeSvc() {
  const prismaSvc = { client: ctx.prisma } as any;
  const heldLocks = new Set<string>();
  const redisLock = {
    acquire: jest.fn(async (key: string) => { if (heldLocks.has(key)) return null; heldLocks.add(key); return 'tok'; }),
    release: jest.fn(async (key: string) => { heldLocks.delete(key); }),
  } as any;
  const auditLogger = {
    log: jest.fn(async (p: any) => {
      await ctx.prisma.auditLog.create({
        data: {
          actorType: p.actorType, actorId: p.actorId, actorName: p.actorName, action: p.action, entity: p.entity,
          entityId: p.entityId ?? null, details: p.details ?? null, actionCategory: p.actionCategory ?? 'OPERATIONAL',
        },
      });
    }),
  } as any;
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
    computeEarnedPoints: jest.fn(() => 0),
  } as any;
  const svc = new PaymentService(configShim() as any, prismaSvc, redisLock, auditLogger, notificationService, emailService, availabilityCache, loyalty);
  const watch = new GatewayWatchService(prismaSvc, { withLeaderLock: jest.fn() } as any, svc);
  return { svc, watch, redisLock, auditLogger, notificationService, availabilityCache, loyalty };
}

const ADMIN = { adminId: 'admin-user-1', adminName: 'Ali Admin' };
const INPUT = { transactionId: 'PAY2M-TXN-0001', note: 'Checked in the PAY2M dashboard: captured 22 Nov 10:12' };

function signNaps(basketId: string, amount: string, errCode: string): string {
  return crypto.createHash('sha256').update(`${PAY2M.MERCHANT_ID}${basketId}${PAY2M.SECRET_WORD}${errCode}${amount}`).digest('hex');
}

/** A PENDING booking + PAY2M payment with a basket (what /payment/initiate leaves behind). */
type Seed = Awaited<ReturnType<typeof seedReference>>;
async function seedPending(seed: Seed, opts: { paymentStatus?: 'PENDING' | 'FAILED'; amount?: number; couponCode?: string; pointsRedeemed?: number } = {}) {
  const basketId = `JDWL-${crypto.randomUUID().slice(0, 8)}-${crypto.randomUUID().slice(0, 3)}`;
  const amount = opts.amount ?? 1200;
  const payment = await ctx.prisma.payment.create({
    data: { amount, currency: 'QAR', status: opts.paymentStatus ?? 'PENDING', method: 'PAY2M', gatewayBasketId: basketId },
  });
  const booking = await ctx.prisma.booking.create({
    data: {
      ref: `JDWL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, currencyCode: 'QAR',
      guests: 2, bookingPhone: '+97455123456', totalPrice: amount - 5, serviceFee: 5, commissionAmount: 100,
      couponCode: opts.couponCode ?? null, pointsRedeemed: opts.pointsRedeemed ?? 0, pointsDiscount: opts.pointsRedeemed ?? 0,
      status: 'PENDING',
      startDatetime: new Date('2031-03-01T10:00:00Z'), endDatetime: new Date('2031-03-01T12:00:00Z'),
      activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
      paymentId: payment.id, reservedUntil: new Date(Date.now() + 600_000),
    },
  });
  await ctx.prisma.payment.update({ where: { id: payment.id }, data: { bookingId: booking.id, bookingSnapshot: buildBookingSnapshot(booking as any) as any } });
  return { basketId, payment, booking };
}

/** A competing CONFIRMED booking that fills the same window (capacity 10 seats). */
async function fillSlot(seed: Seed, guests: number) {
  const other = await ctx.prisma.user.create({ data: { fullName: 'Other', email: `o-${crypto.randomUUID().slice(0, 6)}@test.com`, password: 'x', role: 'CUSTOMER' } });
  await ctx.prisma.booking.create({
    data: {
      ref: `JDWL-OTHER-${crypto.randomUUID().slice(0, 4)}`, currencyCode: 'QAR', guests, bookingPhone: '+97455000000',
      totalPrice: 100, serviceFee: 0, status: 'CONFIRMED',
      startDatetime: new Date('2031-03-01T10:00:00Z'), endDatetime: new Date('2031-03-01T12:00:00Z'),
      activityId: seed.activity.id, customerId: other.id, vendorId: seed.vendor.id,
    },
  });
}

describe('confirmPaymentManually — PENDING booking', () => {
  it('confirms the booking through the normal confirmation path, records the admin, txn and note', async () => {
    const { svc, notificationService, auditLogger, availabilityCache } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const { payment, booking, basketId } = await seedPending(seed);

    const res = await svc.confirmPaymentManually(payment.id, ADMIN, INPUT);
    expect(res).toEqual({ bookingId: booking.id, ref: booking.ref, path: 'confirmed' });

    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe('SUCCESS');
    expect(p.gatewayTxnId).toBe(INPUT.transactionId);
    expect(p.paidAt).toBeTruthy();
    expect(p.method).toBe('PAY2M');
    expect(p.payoutStatus).toBe('UNPAID');
    expect(Number(p.amount)).toBe(1200); // frozen amount, untouched
    expect(p.manualConfirmedAt).toBeTruthy();
    expect(p.manualConfirmedBy).toBe(ADMIN.adminId);

    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(b.status).toBe('CONFIRMED');

    // Same announcements as a normal confirmation.
    expect(notificationService.send).toHaveBeenCalledWith(expect.objectContaining({ userId: seed.customer.id, type: 'PAYMENT_SUCCESS', link: `/bookings/${booking.id}` }));
    expect(notificationService.send).toHaveBeenCalledWith(expect.objectContaining({ userId: seed.vendorUser.id, type: 'BOOKING_NEW' }));
    expect(notificationService.notifyAdmins).toHaveBeenCalledWith(expect.objectContaining({ type: 'BOOKING_NEW' }));
    const outbox = await ctx.prisma.emailOutbox.findMany({ where: { bookingId: booking.id }, orderBy: { emailType: 'asc' } });
    expect(outbox.map((o) => o.emailType).sort()).toEqual(['BOOKING_CONFIRMATION', 'VENDOR_BOOKING_NOTIFICATION']);
    expect((outbox.find((o) => o.emailType === 'BOOKING_CONFIRMATION')!.payload as any).totalAmount).toBe('1200.00');
    expect(availabilityCache.invalidate).toHaveBeenCalledWith(seed.activity.id);

    // FINANCIAL audit row by the admin, with the transaction id and the note.
    const audit = await ctx.prisma.auditLog.findMany({ where: { action: 'PAYMENT_MARKED_PAID_BY_ADMIN' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toEqual(expect.objectContaining({ actorType: 'ADMIN', actorId: ADMIN.adminId, actorName: ADMIN.adminName, entity: 'Payment', entityId: payment.id, actionCategory: 'FINANCIAL' }));
    expect(audit[0].details).toContain(`txn: ${INPUT.transactionId}`);
    expect(audit[0].details).toContain(`note: ${INPUT.note}`);
    expect(audit[0].details).toContain(`basket: ${basketId}`);
    expect(audit[0].details).toContain('path: confirmed');
    expect(auditLogger.log).toHaveBeenCalledTimes(1);
  });

  it('a second click gets 409 and changes nothing; two concurrent clicks confirm once', async () => {
    const { svc } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const { payment } = await seedPending(seed);
    await svc.confirmPaymentManually(payment.id, ADMIN, INPUT);
    await expect(svc.confirmPaymentManually(payment.id, ADMIN, { ...INPUT, transactionId: 'PAY2M-TXN-0002' })).rejects.toBeInstanceOf(ConflictException);
    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.gatewayTxnId).toBe(INPUT.transactionId);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'PAYMENT_MARKED_PAID_BY_ADMIN' } })).toBe(1);

    const { svc: svc2 } = makeSvc();
    const second = await seedPending(seed);
    const results = await Promise.allSettled([
      svc2.confirmPaymentManually(second.payment.id, ADMIN, { ...INPUT, transactionId: 'PAY2M-TXN-0004' }),
      svc2.confirmPaymentManually(second.payment.id, ADMIN, { ...INPUT, transactionId: 'PAY2M-TXN-0005' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'PAYMENT_MARKED_PAID_BY_ADMIN', entityId: second.payment.id } })).toBe(1);
  });

  it('a FAILED payment (reaped by the cleanup, booking still there) is accepted', async () => {
    const { svc } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const { payment, booking } = await seedPending(seed, { paymentStatus: 'FAILED' });
    const res = await svc.confirmPaymentManually(payment.id, ADMIN, INPUT);
    expect(res.path).toBe('confirmed');
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CONFIRMED');
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('SUCCESS');
  });

  it('refuses when the slot was taken in the meantime, and nothing changes', async () => {
    const { svc, notificationService } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const { payment, booking } = await seedPending(seed);
    await fillSlot(seed, 9); // capacity 10, this booking needs 2 → only 1 seat left
    await expect(svc.confirmPaymentManually(payment.id, ADMIN, INPUT)).rejects.toThrow('The slot was taken by another booking in the meantime. Nothing was changed.');
    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe('PENDING');
    expect(p.gatewayTxnId).toBeNull();
    expect(p.manualConfirmedAt).toBeNull();
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('PENDING');
    expect(notificationService.send).not.toHaveBeenCalled();
    expect(await ctx.prisma.auditLog.count({ where: { action: 'PAYMENT_MARKED_PAID_BY_ADMIN' } })).toBe(0);
  });

  it('refuses an already paid payment, a refund-pending payment, a payment without a basket, a reused transaction id', async () => {
    const { svc } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const paid = await seedPending(seed);
    await ctx.prisma.payment.update({ where: { id: paid.payment.id }, data: { status: 'SUCCESS', gatewayTxnId: 'TXN-USED' } });
    await expect(svc.confirmPaymentManually(paid.payment.id, ADMIN, INPUT)).rejects.toThrow('already confirmed');

    const refundPending = await ctx.prisma.payment.create({ data: { amount: 10, currency: 'QAR', status: 'REFUND_PENDING', method: 'PAY2M', gatewayBasketId: 'BSK-RP' } });
    await expect(svc.confirmPaymentManually(refundPending.id, ADMIN, INPUT)).rejects.toBeInstanceOf(BadRequestException);

    const noBasket = await ctx.prisma.payment.create({ data: { amount: 10, currency: 'QAR', status: 'PENDING', method: 'PAY2M' } });
    await expect(svc.confirmPaymentManually(noBasket.id, ADMIN, INPUT)).rejects.toThrow('never sent to PAY2M');

    const other = await seedPending(seed);
    await expect(svc.confirmPaymentManually(other.payment.id, ADMIN, { ...INPUT, transactionId: 'TXN-USED' })).rejects.toThrow(`Transaction ID TXN-USED is already recorded on booking ${paid.booking.ref}`);
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: other.payment.id } })).status).toBe('PENDING');
  });

  it('refuses when the activity already ended or is not active', async () => {
    const { svc } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const ended = await seedPending(seed);
    await ctx.prisma.booking.update({ where: { id: ended.booking.id }, data: { startDatetime: new Date('2020-01-01T10:00:00Z'), endDatetime: new Date('2020-01-01T12:00:00Z') } });
    await expect(svc.confirmPaymentManually(ended.payment.id, ADMIN, INPUT)).rejects.toThrow('already passed');

    const inactive = await seedPending(seed);
    await ctx.prisma.activity.update({ where: { id: seed.activity.id }, data: { status: 'INACTIVE' } });
    await expect(svc.confirmPaymentManually(inactive.payment.id, ADMIN, INPUT)).rejects.toThrow('no longer active');
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: inactive.payment.id } })).status).toBe('PENDING');
  });
});

describe('confirmPaymentManually — booking CANCELLED by the customer', () => {
  it('un-cancels the booking, re-debits the redeemed points and the coupon use', async () => {
    const { svc, loyalty } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const { payment, booking } = await seedPending(seed, { paymentStatus: 'FAILED', couponCode: 'SAVE5', pointsRedeemed: 50 });
    const coupon = await ctx.prisma.coupon.create({
      data: {
        code: 'SAVE5', vendorId: seed.vendor.id, status: 'APPROVED', discountType: 'FIXED', discountValue: 5,
        validFrom: new Date('2020-01-01'), validTo: new Date('2040-01-01'), usageLimit: 10, usedCount: 0,
      },
    });
    // What the customer's unpaid cancel leaves behind (points and coupon already returned).
    await ctx.prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: 'CUSTOMER' } });

    const res = await svc.confirmPaymentManually(payment.id, ADMIN, INPUT);
    expect(res.path).toBe('uncancelled');

    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(b.status).toBe('CONFIRMED');
    expect(b.cancelledAt).toBeNull();
    expect(b.cancelledBy).toBeNull();
    expect(b.paymentId).toBe(payment.id);
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('SUCCESS');
    expect((await ctx.prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(1);
    expect(loyalty.redeem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: seed.customer.id, amount: 50, bookingId: booking.id }));
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'PAYMENT_MARKED_PAID_BY_ADMIN' } });
    expect(audit.details).toContain('path: uncancelled');
  });

  it('refuses when the freed slot was taken, leaving the booking cancelled', async () => {
    const { svc } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const { payment, booking } = await seedPending(seed, { paymentStatus: 'FAILED' });
    await ctx.prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: 'CUSTOMER' } });
    await fillSlot(seed, 10);
    await expect(svc.confirmPaymentManually(payment.id, ADMIN, INPUT)).rejects.toThrow('taken by another booking');
    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(b.status).toBe('CANCELLED');
    expect(b.cancelledBy).toBe('CUSTOMER');
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('FAILED');
  });
});

describe('confirmPaymentManually — booking deleted by the cleanup cron', () => {
  it('re-creates the booking from the snapshot with its original id and ref', async () => {
    const { svc, notificationService } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const { payment, booking } = await seedPending(seed, { paymentStatus: 'FAILED' });
    await ctx.prisma.booking.delete({ where: { id: booking.id } }); // what the cleanup does (payment row kept)

    const res = await svc.confirmPaymentManually(payment.id, ADMIN, INPUT);
    expect(res).toEqual({ bookingId: booking.id, ref: booking.ref, path: 'recreated' });

    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(b.status).toBe('CONFIRMED');
    expect(b.ref).toBe(booking.ref);
    expect(Number(b.totalPrice)).toBe(1195);
    expect(b.paymentId).toBe(payment.id);
    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe('SUCCESS');
    expect(p.bookingRecreatedAt).toBeTruthy();
    expect(p.bookingId).toBe(booking.id);
    expect(notificationService.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'PAYMENT_SUCCESS', link: `/bookings/${booking.id}` }));
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'PAYMENT_MARKED_PAID_BY_ADMIN' } });
    expect(audit.details).toContain('path: recreated');
  });

  it('refuses when the slot is taken (no booking, payment untouched) and when there is no snapshot', async () => {
    const { svc } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const { payment, booking } = await seedPending(seed, { paymentStatus: 'FAILED' });
    await ctx.prisma.booking.delete({ where: { id: booking.id } });
    await fillSlot(seed, 9);
    await expect(svc.confirmPaymentManually(payment.id, ADMIN, INPUT)).rejects.toThrow('taken by another booking');
    expect(await ctx.prisma.booking.findUnique({ where: { id: booking.id } })).toBeNull();
    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe('FAILED');
    expect(p.bookingRecreatedAt).toBeNull();

    const noSnap = await seedPending(seed, { paymentStatus: 'FAILED' });
    await ctx.prisma.booking.delete({ where: { id: noSnap.booking.id } });
    await ctx.prisma.payment.update({ where: { id: noSnap.payment.id }, data: { bookingSnapshot: null as any } });
    await expect(svc.confirmPaymentManually(noSnap.payment.id, ADMIN, INPUT)).rejects.toThrow('no usable booking snapshot');
  });
});

describe('rescue markers stamped by the callback', () => {
  it('a success-looking callback that fails verification is still rejected, but stamped and alerted once', async () => {
    const { svc, notificationService } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const { payment, basketId, booking } = await seedPending(seed);
    const bad = { err_code: '000', basket_id: basketId, transaction_id: 'T1', Response_Key: 'f'.repeat(64) };
    await expect(svc.handleCallback(bad)).rejects.toThrow('Payment verification failed');

    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe('PENDING');
    expect(p.unverifiedCallbackAt).toBeTruthy();
    expect(p.unverifiedCallbackErrCode).toBe('000');
    expect(p.gatewayAlertedAt).toBeTruthy();
    expect(notificationService.notifyAdmins).toHaveBeenCalledTimes(1);
    expect(notificationService.notifyAdmins).toHaveBeenCalledWith(expect.objectContaining({
      type: 'SYSTEM',
      title: 'Debit card payment could not be verified',
      message: expect.stringContaining(booking.ref),
      link: '/admin/bookings?gateway=unconfirmed',
    }));
    expect(notificationService.notifyAdmins.mock.calls[0][0].message).toContain(basketId);
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('PENDING');

    // A second unverified callback updates the stamp but does not alert again.
    await expect(svc.handleCallback({ ...bad, err_code: '001' })).rejects.toThrow('Payment verification failed');
    const p2 = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p2.unverifiedCallbackErrCode).toBe('001');
    expect(notificationService.notifyAdmins).toHaveBeenCalledTimes(1);
  });

  it('a failed-code callback with a bad hash is NOT a rescue candidate', async () => {
    const { svc, notificationService } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const { payment, basketId } = await seedPending(seed);
    await expect(svc.handleCallback({ err_code: '97', basket_id: basketId, Response_Key: 'f'.repeat(64) })).rejects.toThrow('Payment verification failed');
    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.unverifiedCallbackAt).toBeNull();
    expect(notificationService.notifyAdmins).not.toHaveBeenCalled();
  });

  it('a verified NAPS success is held as before and stamps napsHeldAt once', async () => {
    const { svc } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const { payment, basketId, booking } = await seedPending(seed, { amount: 200 });
    const key = signNaps(basketId, '200', '00');
    const res = await svc.handleCallback({ err_code: '001', basket_id: basketId, transaction_id: 'TN', Response_Key: key });
    expect(res.status).toBe('pending');
    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe('PENDING');
    expect(p.napsHeldAt).toBeTruthy();
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('PENDING');
    const first = p.napsHeldAt!.getTime();
    await svc.handleCallback({ err_code: '001', basket_id: basketId, transaction_id: 'TN', Response_Key: key });
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).napsHeldAt!.getTime()).toBe(first);
  });

  it('a held payment can then be marked as paid by the admin', async () => {
    const { svc } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const { payment, basketId, booking } = await seedPending(seed, { amount: 200 });
    await svc.handleCallback({ err_code: '001', basket_id: basketId, transaction_id: 'TN', Response_Key: signNaps(basketId, '200', '00') });
    const res = await svc.confirmPaymentManually(payment.id, ADMIN, INPUT);
    expect(res.path).toBe('confirmed');
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CONFIRMED');
  });
});

describe('GatewayWatchService — held for 10 minutes', () => {
  it('alerts once per payment, only after 10 minutes, never for a confirmed payment', async () => {
    const { watch, notificationService } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const now = new Date();
    const old = await seedPending(seed);
    await ctx.prisma.payment.update({ where: { id: old.payment.id }, data: { napsHeldAt: new Date(now.getTime() - HELD_ALERT_AFTER_MS - 60_000) } });
    const fresh = await seedPending(seed);
    await ctx.prisma.payment.update({ where: { id: fresh.payment.id }, data: { napsHeldAt: new Date(now.getTime() - 5 * 60_000) } });
    const confirmed = await seedPending(seed);
    await ctx.prisma.payment.update({ where: { id: confirmed.payment.id }, data: { napsHeldAt: new Date(now.getTime() - 60 * 60_000), status: 'SUCCESS' } });

    expect(await watch.run(now)).toBe(1);
    expect(notificationService.notifyAdmins).toHaveBeenCalledTimes(1);
    expect(notificationService.notifyAdmins).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Debit card payment awaiting confirmation',
      message: expect.stringContaining(old.booking.ref),
    }));
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: old.payment.id } })).gatewayAlertedAt).toBeTruthy();
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: fresh.payment.id } })).gatewayAlertedAt).toBeNull();

    expect(await watch.run(now)).toBe(0); // second run: nothing new
    expect(await watch.run(new Date(now.getTime() + 10 * 60_000))).toBe(1); // the fresh one crosses 10 minutes
    expect(notificationService.notifyAdmins).toHaveBeenCalledTimes(2);
  });
});

describe('getPaymentStatus + the admin unconfirmed list', () => {
  it('tells the customer page the payment is awaiting bank confirmation', async () => {
    const { svc } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const { payment, booking } = await seedPending(seed);
    expect((await svc.getPaymentStatus(booking.id, seed.customer.id)).awaitingBankConfirmation).toBe(false);
    await ctx.prisma.payment.update({ where: { id: payment.id }, data: { unverifiedCallbackAt: new Date(), unverifiedCallbackErrCode: '000' } });
    expect((await svc.getPaymentStatus(booking.id, seed.customer.id)).awaitingBankConfirmation).toBe(true);
    await svc.confirmPaymentManually(payment.id, ADMIN, INPUT);
    expect((await svc.getPaymentStatus(booking.id, seed.customer.id)).awaitingBankConfirmation).toBe(false);
  });

  it('lists pending, cancelled and expired (deleted) bookings with a gateway report', async () => {
    const admin = new AdminService({ client: ctx.prisma } as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const seed = await seedReference(ctx.prisma);
    const pending = await seedPending(seed);
    await ctx.prisma.payment.update({ where: { id: pending.payment.id }, data: { unverifiedCallbackAt: new Date(), unverifiedCallbackErrCode: '000' } });
    const cancelled = await seedPending(seed, { paymentStatus: 'FAILED' });
    await ctx.prisma.payment.update({ where: { id: cancelled.payment.id }, data: { napsHeldAt: new Date() } });
    await ctx.prisma.booking.update({ where: { id: cancelled.booking.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: 'CUSTOMER' } });
    const deleted = await seedPending(seed, { paymentStatus: 'FAILED' });
    await ctx.prisma.payment.update({ where: { id: deleted.payment.id }, data: { unverifiedCallbackAt: new Date(), unverifiedCallbackErrCode: '000' } });
    await ctx.prisma.booking.delete({ where: { id: deleted.booking.id } });
    const quiet = await seedPending(seed); // no gateway report → not listed
    void quiet;

    const rows = await admin.getUnconfirmedGatewayPayments();
    expect(rows.map((r) => r.id).sort()).toEqual([pending.payment.id, cancelled.payment.id, deleted.payment.id].sort());
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(pending.payment.id)!.booking).toEqual(expect.objectContaining({ ref: pending.booking.ref, status: 'PENDING', exists: true }));
    expect(byId.get(cancelled.payment.id)!.booking).toEqual(expect.objectContaining({ status: 'CANCELLED', cancelledBy: 'CUSTOMER', exists: true }));
    expect(byId.get(deleted.payment.id)!.booking).toEqual(expect.objectContaining({ id: null, ref: deleted.booking.ref, status: 'EXPIRED', exists: false }));
    expect(byId.get(deleted.payment.id)!.customer).toEqual(expect.objectContaining({ fullName: 'Test Customer' }));
    expect(byId.get(deleted.payment.id)!.activityTitle).toBe('Sample Tour');
    expect(byId.get(pending.payment.id)!.basketId).toBe(pending.basketId);
  });
});
