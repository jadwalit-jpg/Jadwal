/**
 * PaymentService unit tests — PAY2M gateway mocked (UAT is down).
 *
 * Covers: callback hash verification (timing-safe SHA256), initiate guards,
 * callback idempotency + tamper detection, status reporting, error mapping.
 *
 * Full fetch → PAY2M network path is exercised at the integration tier.
 */

import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as crypto from 'crypto';
import { PaymentService } from '../../src/payment/payment.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { RedisLockService } from '../../src/redis/redis-lock.service';
import { AvailabilityCacheService } from '../../src/redis/availability-cache.service';
import { AuditLoggerService } from '../../src/common/services/audit-logger.service';
import { NotificationService } from '../../src/common/services/notification.service';
import { EmailService } from '../../src/email/email.service';
import { makePrismaMock } from '../mocks/prisma.mock';
import { makeConfigMock, makeEmailMock } from '../mocks/auth-deps.mock';
import {
  makeAuditLoggerMock, makeNotificationMock, makeRedisLockMock, makeAvailabilityCacheMock,
} from '../mocks/bookings-deps.mock';

const PAY2M_CFG = {
  PAYMENT_ENABLED:      'true',
  PAY2M_MERCHANT_ID:    'TEST_MID',
  PAY2M_MERCHANT_NAME:  'Jadwal Test',
  PAY2M_SECURED_KEY:    'test-secured-key',
  PAY2M_SECRET_WORD:    'TEST_SECRET_WORD',
  PAY2M_API_URL:        'https://pay2m.example/api',
  PAY2M_RETURN_URL:     'https://jadwal.example/payment/callback',
};

async function buildSut(enabled = true) {
  const prisma  = makePrismaMock();
  const config  = makeConfigMock({ ...PAY2M_CFG, PAYMENT_ENABLED: enabled ? 'true' : 'false' });
  const lock    = makeRedisLockMock();
  const cache   = makeAvailabilityCacheMock();
  const audit   = makeAuditLoggerMock();
  const notif   = makeNotificationMock();
  const email   = makeEmailMock();

  const mod = await Test.createTestingModule({
    providers: [
      PaymentService,
      { provide: PrismaService,            useValue: prisma },
      { provide: ConfigService,            useValue: config },
      { provide: RedisLockService,         useValue: lock },
      { provide: AvailabilityCacheService, useValue: cache },
      { provide: AuditLoggerService,       useValue: audit },
      { provide: NotificationService,      useValue: notif },
      { provide: EmailService,             useValue: email },
    ],
  }).compile();

  return { sut: mod.get(PaymentService), prisma, config, lock, cache, audit, notif, email };
}

/**
 * Build a valid PAY2M callback Response_Key hash for the given inputs.
 * Recipe (PAY2M Merchant Integration Guide, Table 1.2):
 *   SHA256(merchant_id + basket_id + secret_word + amount + err_code).
 */
function buildResponseKey(basketId: string, amount: string, errCode: string): string {
  const raw = `${PAY2M_CFG.PAY2M_MERCHANT_ID}${basketId}${PAY2M_CFG.PAY2M_SECRET_WORD}${amount}${errCode}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ═══════════════════════════════════════════════════════════════════════════
// verifyCallbackHash — pure SHA256 + timing-safe compare
// ═══════════════════════════════════════════════════════════════════════════

describe('PaymentService.verifyCallbackHash', () => {
  test('correct hash returns true', async () => {
    const ctx = await buildSut();
    const key = buildResponseKey('JDWL-ABC', '100.00', '00');
    expect(ctx.sut.verifyCallbackHash('JDWL-ABC', '100.00', '00', key)).toBe(true);
  });

  test('tampered basketId → false', async () => {
    const ctx = await buildSut();
    const key = buildResponseKey('JDWL-ABC', '100.00', '00');
    expect(ctx.sut.verifyCallbackHash('JDWL-EVIL', '100.00', '00', key)).toBe(false);
  });

  test('tampered amount → false (amount tampering attack)', async () => {
    const ctx = await buildSut();
    const key = buildResponseKey('JDWL-ABC', '100.00', '00');
    expect(ctx.sut.verifyCallbackHash('JDWL-ABC', '1.00', '00', key)).toBe(false);
  });

  test('tampered errCode → false', async () => {
    const ctx = await buildSut();
    const key = buildResponseKey('JDWL-ABC', '100.00', '42');
    expect(ctx.sut.verifyCallbackHash('JDWL-ABC', '100.00', '00', key)).toBe(false);
  });

  test('short/invalid response key length → false (no throw)', async () => {
    const ctx = await buildSut();
    expect(ctx.sut.verifyCallbackHash('JDWL-ABC', '100.00', '00', 'short')).toBe(false);
  });

  test('case-insensitive hex comparison', async () => {
    const ctx = await buildSut();
    const key = buildResponseKey('JDWL-ABC', '100.00', '00');
    expect(ctx.sut.verifyCallbackHash('JDWL-ABC', '100.00', '00', key.toUpperCase())).toBe(true);
  });

  test('amount-format tolerant: hash built with "1" verifies when caller passes "1.00"', async () => {
    const ctx = await buildSut();
    // PAY2M normalises the amount (strips trailing zeros): a transaction
    // sent as "1.00" comes back hashed as "1". verifyCallbackHash tries the
    // canonical numeric forms, so a caller passing "1.00" still matches.
    const key = buildResponseKey('JDWL-ABC', '1', '00');
    expect(ctx.sut.verifyCallbackHash('JDWL-ABC', '1.00', '00', key)).toBe(true);
  });

  // ── NAPS/QPay rail (err+amount order) is ACCEPTED for AUTHENTICITY ──
  // PAY2M signs NAPS as merchant+basket+secret+err+amount (proven from live
  // recipeMatch diagnostics 2026-06-10). Accepting the order lets us READ
  // genuine NAPS callbacks (rejecting them destroyed PAID bookings — the
  // money-taken-no-booking incident). Success handling stays rail-aware:
  // handleCallback HOLDS a NAPS success instead of confirming it, because the
  // rail can emit success-signed callbacks pre-capture (basket 939bd325).
  test('NAPS swapped order (err+amount, integer amount) verifies as AUTHENTIC', async () => {
    const ctx = await buildSut();
    const raw = `${PAY2M_CFG.PAY2M_MERCHANT_ID}JDWL-NAPS${PAY2M_CFG.PAY2M_SECRET_WORD}001`; // err"00"+amt"1"
    const key = crypto.createHash('sha256').update(raw).digest('hex');
    expect(ctx.sut.verifyCallbackHash('JDWL-NAPS', '1.00', '001', key)).toBe(true);
  });

  test('success-code spelling: hash built with "00" verifies when callback echoes "000"', async () => {
    const ctx = await buildSut();
    const key = buildResponseKey('JDWL-NAPS', '100.00', '00');
    expect(ctx.sut.verifyCallbackHash('JDWL-NAPS', '100.00', '000', key)).toBe(true);
  });

  test('success-code spelling: hash built with "000" verifies when callback echoes "00"', async () => {
    const ctx = await buildSut();
    const key = buildResponseKey('JDWL-NAPS', '100.00', '000');
    expect(ctx.sut.verifyCallbackHash('JDWL-NAPS', '100.00', '00', key)).toBe(true);
  });

  // SECURITY: trying extra amount forms / both field orders must NOT let a
  // wrong amount or a non-success code masquerade as a valid success.
  test('SECURITY: genuinely wrong amount still fails', async () => {
    const ctx = await buildSut();
    const key = buildResponseKey('JDWL-NAPS', '100.00', '00'); // signed for 100.00
    // We only ever charged 1.00 — no rendering/order of "1" equals "100.00".
    expect(ctx.sut.verifyCallbackHash('JDWL-NAPS', '1.00', '00', key)).toBe(false);
  });

  test('SECURITY: a failure-code signature cannot be replayed as a success', async () => {
    const ctx = await buildSut();
    // PAY2M signed this Response_Key for failure code "42"; a forged callback
    // claims success "000". We only ever try {received, "00", "000"} — never
    // "42" with a swapped amount — so the hash cannot match as success.
    const key = buildResponseKey('JDWL-NAPS', '100.00', '42');
    expect(ctx.sut.verifyCallbackHash('JDWL-NAPS', '100.00', '000', key)).toBe(false);
  });

  // ── resolveSignedErrCode: returns the SIGNED code + the RAIL that signed it
  //    (private, accessed via `as any`). handleCallback trusts the code that
  //    cryptographically signed the hash — NOT the raw err_code field — and
  //    uses the rail to decide confirm (card) vs hold (naps).
  test('signed code: NAPS swapped-order success resolves to {errCode 00, rail naps}', async () => {
    const ctx = await buildSut();
    const raw = `${PAY2M_CFG.PAY2M_MERCHANT_ID}JDWL-NAPS${PAY2M_CFG.PAY2M_SECRET_WORD}001`; // err"00"+amt"1"
    const key = crypto.createHash('sha256').update(raw).digest('hex');
    const signed = (ctx.sut as any).resolveSignedErrCode('JDWL-NAPS', '1.00', '001', key);
    expect(signed).toEqual({ errCode: '00', rail: 'naps' });
  });

  test('signed code: card success resolves to {errCode, rail card}', async () => {
    const ctx = await buildSut();
    const key = buildResponseKey('JDWL-ABC', '100.00', '000'); // amount+err order
    const signed = (ctx.sut as any).resolveSignedErrCode('JDWL-ABC', '100.00', '000', key);
    expect(signed).toEqual({ errCode: '000', rail: 'card' });
  });

  test('signed code: NAPS-order FAILURE resolves to its failure code on the naps rail', async () => {
    const ctx = await buildSut();
    // Genuine NAPS cancel ("901"), err+amount order — must resolve so the
    // failure path can clean up, and must never read as success.
    const raw = `${PAY2M_CFG.PAY2M_MERCHANT_ID}JDWL-NAPS${PAY2M_CFG.PAY2M_SECRET_WORD}901100`; // err"901"+amt"100"
    const key = crypto.createHash('sha256').update(raw).digest('hex');
    const signed = (ctx.sut as any).resolveSignedErrCode('JDWL-NAPS', '100.00', '901', key);
    expect(signed).toEqual({ errCode: '901', rail: 'naps' });
  });

  test('SECURITY signed code: a failure-signed hash resolves to the FAILURE code, never success', async () => {
    const ctx = await buildSut();
    // Real decline ("97" insufficient balance), amount+err order.
    const key = buildResponseKey('JDWL-ABC', '100.00', '97');
    const signed = (ctx.sut as any).resolveSignedErrCode('JDWL-ABC', '100.00', '97', key);
    expect(signed?.errCode).toBe('97');                         // resolves to the failure code
    expect(signed?.errCode === '00' || signed?.errCode === '000').toBe(false); // → NOT success
  });

  test('SECURITY signed code: forged/invalid hash resolves to null (neither rail matches)', async () => {
    const ctx = await buildSut();
    const signed = (ctx.sut as any).resolveSignedErrCode('JDWL-ABC', '100.00', '000', 'a'.repeat(64));
    expect(signed).toBeNull();
  });

  // Regression (2026-04-22): defence-in-depth format gate.
  // Prior implementation hit `Buffer.from(responseKey.toLowerCase())` BEFORE
  // any length/shape check, so a 10 MB garbage input paid O(n) string +
  // buffer cost before throwing on length mismatch. The gate now rejects
  // obvious non-hex / wrong-length inputs in O(1).
  describe('verifyCallbackHash — format gate', () => {
    test('non-hex characters → false without crash', async () => {
      const ctx = await buildSut();
      // 64 chars but contains non-hex (z) — must be rejected upfront
      expect(ctx.sut.verifyCallbackHash('JDWL-ABC', '100.00', '00', 'z'.repeat(64))).toBe(false);
    });

    test('65-char input (wrong length) → false', async () => {
      const ctx = await buildSut();
      expect(ctx.sut.verifyCallbackHash('JDWL-ABC', '100.00', '00', 'a'.repeat(65))).toBe(false);
    });

    test('63-char input (wrong length) → false', async () => {
      const ctx = await buildSut();
      expect(ctx.sut.verifyCallbackHash('JDWL-ABC', '100.00', '00', 'a'.repeat(63))).toBe(false);
    });

    test('empty string → false', async () => {
      const ctx = await buildSut();
      expect(ctx.sut.verifyCallbackHash('JDWL-ABC', '100.00', '00', '')).toBe(false);
    });

    test('non-string (number coerced via attacker bypass) → false', async () => {
      const ctx = await buildSut();
      // Defence: even if a DTO pipe fails, verifyCallbackHash must not crash
      expect(ctx.sut.verifyCallbackHash('JDWL-ABC', '100.00', '00', 12345 as any)).toBe(false);
      expect(ctx.sut.verifyCallbackHash('JDWL-ABC', '100.00', '00', null as any)).toBe(false);
      expect(ctx.sut.verifyCallbackHash('JDWL-ABC', '100.00', '00', undefined as any)).toBe(false);
    });

    test('huge payload (10 KB) → rejected fast (DoS defence)', async () => {
      const ctx = await buildSut();
      const huge = 'a'.repeat(10_000);
      const start = Date.now();
      expect(ctx.sut.verifyCallbackHash('JDWL-ABC', '100.00', '00', huge)).toBe(false);
      // Regex test on 10 KB string should be well under 10 ms; generous bound
      // just to catch a pathological regression (e.g. someone removing the gate)
      expect(Date.now() - start).toBeLessThan(50);
    });

    test('still rejects a valid-looking but wrong hash (content mismatch)', async () => {
      const ctx = await buildSut();
      // 64 hex chars, plausible format, but not the real hash for these inputs
      expect(ctx.sut.verifyCallbackHash('JDWL-ABC', '100.00', '00', 'a'.repeat(64))).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// initiatePayment — guard matrix
// ═══════════════════════════════════════════════════════════════════════════

describe('PaymentService.initiatePayment — guards', () => {
  test('400 when PAYMENT_ENABLED=false (pre-DB)', async () => {
    const ctx = await buildSut(false);
    await expect(ctx.sut.initiatePayment('b1', 'u1'))
      .rejects.toThrow(/not available/i);
    expect(ctx.prisma._client.booking.findFirst).not.toHaveBeenCalled();
  });

  test('404 when booking does not exist', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce(null);
    await expect(ctx.sut.initiatePayment('b-missing', 'u1'))
      .rejects.toThrow(NotFoundException);
  });

  test('404 when booking belongs to another user (IDOR collapsed to 404)', async () => {
    // Ownership baked into where → foreign-customer rows never returned.
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce(null);
    await expect(ctx.sut.initiatePayment('b1', 'u1'))
      .rejects.toThrow(NotFoundException);
    expect(ctx.prisma._client.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'b1', customerId: 'u1' }) }),
    );
  });

  test('400 when booking is not PENDING', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce({
      id: 'b1', status: 'CONFIRMED',
      reservedUntil: new Date(Date.now() + 10 * 60 * 1000),
      paymentId: 'p1', ref: 'JDWL-1', activity: { titleEn: 'T' },
    });
    await expect(ctx.sut.initiatePayment('b1', 'u1'))
      .rejects.toThrow(/not in a payable state/i);
  });

  test('400 when reservation expired (within 1-minute buffer)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce({
      id: 'b1', status: 'PENDING',
      reservedUntil: new Date(Date.now() + 30 * 1000), // 30s from now → within buffer
      paymentId: 'p1', ref: 'JDWL-1', activity: { titleEn: 'T' },
    });
    await expect(ctx.sut.initiatePayment('b1', 'u1'))
      .rejects.toThrow(/reservation has expired/i);
  });

  test('400 when booking has no payment record', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce({
      id: 'b1', status: 'PENDING',
      reservedUntil: new Date(Date.now() + 10 * 60 * 1000),
      // Email-OTP already verified — the test exercises the post-gate
      // "no payment record" path, not the gate itself. Mirrors live state
      // where customer entered the 6-digit code before clicking Pay.
      emailOtpVerifiedAt: new Date(),
      paymentId: null, ref: 'JDWL-1', activity: { titleEn: 'T' },
    });
    await expect(ctx.sut.initiatePayment('b1', 'u1'))
      .rejects.toThrow(/not in a payable state/i);
  });

  test('400 when payment already SUCCESS (double-pay guard)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce({
      id: 'b1', status: 'PENDING',
      reservedUntil: new Date(Date.now() + 10 * 60 * 1000),
      emailOtpVerifiedAt: new Date(),
      paymentId: 'p1', ref: 'JDWL-1', activity: { titleEn: 'T' },
    });
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce({
      id: 'p1', amount: 100, currency: 'QAR', status: 'SUCCESS', gatewayBasketId: 'B1',
    });
    await expect(ctx.sut.initiatePayment('b1', 'u1'))
      .rejects.toThrow(/not in a payable state/i);
  });

  test('400 when Redis lock taken (concurrent initiate from another tab)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce({
      id: 'b1', status: 'PENDING',
      reservedUntil: new Date(Date.now() + 10 * 60 * 1000),
      emailOtpVerifiedAt: new Date(),
      paymentId: 'p1', ref: 'JDWL-1', activity: { titleEn: 'T' },
    });
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce({
      id: 'p1', amount: 100, currency: 'QAR', status: 'PENDING', gatewayBasketId: 'B1',
    });
    ctx.lock.acquire.mockResolvedValueOnce(null); // lock taken

    await expect(ctx.sut.initiatePayment('b1', 'u1'))
      .rejects.toThrow(/not in a payable state/i);
  });

  test('400 when emailOtpVerifiedAt is null (email-OTP gate trips)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce({
      id: 'b1', status: 'PENDING',
      reservedUntil: new Date(Date.now() + 10 * 60 * 1000),
      emailOtpVerifiedAt: null,
      paymentId: 'p1', ref: 'JDWL-1', activity: { titleEn: 'T' },
    });
    await expect(ctx.sut.initiatePayment('b1', 'u1'))
      .rejects.toThrow(/verify your email/i);
    // No payment lookup attempted — gate blocks before that I/O.
    expect(ctx.prisma._client.payment.findUnique).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// handleCallback — tamper + idempotency + race-recovery
// ═══════════════════════════════════════════════════════════════════════════

describe('PaymentService.handleCallback', () => {
  test('400 when PAYMENT_ENABLED=false (callback received during maintenance)', async () => {
    const ctx = await buildSut(false);
    await expect(ctx.sut.handleCallback({
      err_code: '00', basket_id: 'B1', Response_Key: 'x',
    })).rejects.toThrow(/not available/i);
  });

  test('400 when basket_id does not match any payment', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce(null);
    await expect(ctx.sut.handleCallback({
      err_code: '00', basket_id: 'UNKNOWN', Response_Key: buildResponseKey('UNKNOWN', '100.00', '00'),
    })).rejects.toThrow(/not found/i);
  });

  test('idempotent: already-SUCCESS payment returns success without re-processing', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce({
      id: 'p1', bookingId: 'b1', amount: 100, status: 'SUCCESS',
    });
    const r = await ctx.sut.handleCallback({
      err_code: '00', basket_id: 'B1', Response_Key: 'anything',
    });
    expect(r).toEqual({ bookingId: 'b1', status: 'success' });
    // No transaction side-effects
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  test('already-FAILED payment + subsequent non-success callback → returns failed', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce({
      id: 'p1', bookingId: 'b1', amount: 100, status: 'FAILED',
    });
    const r = await ctx.sut.handleCallback({
      err_code: '42', basket_id: 'B1', Response_Key: 'x',
    });
    expect(r).toMatchObject({ bookingId: 'b1', status: 'failed' });
  });

  test('SUCCESS callback with TAMPERED hash → 400 + audit PAYMENT_HASH_MISMATCH', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce({
      id: 'p1', bookingId: 'b1', amount: 100, status: 'PENDING',
    });

    await expect(ctx.sut.handleCallback({
      err_code: '00', basket_id: 'B1', Response_Key: 'a'.repeat(64), // wrong hash
    })).rejects.toThrow(/verification failed/i);

    expect(ctx.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYMENT_HASH_MISMATCH' }),
    );
  });

  test('FAILURE callback with invalid hash → REJECTS (PAY-1 always-verify)', async () => {
    // Pre-PAY-1 behavior: invalid hash on a failure callback was let through
    // (the rationale was 'we're marking it FAILED anyway, no security risk').
    // PAY-1 closed that gap — an attacker who knew a victim's basket_id
    // could forge a failure IPN to delete the victim's PENDING booking.
    // Hash verification now applies to every callback regardless of err_code.
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce({
      id: 'p1', bookingId: 'b1', amount: 100, status: 'PENDING',
    });

    await expect(
      ctx.sut.handleCallback({
        err_code: '42', basket_id: 'B1', Response_Key: 'invalid',
      }),
    ).rejects.toThrow(/Payment verification failed/);

    // Audit trail of the rejection — same event as the SUCCESS-with-bad-hash path
    expect(ctx.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYMENT_HASH_MISMATCH' }),
    );
  });

  test('err_code 00 vs 000 both recognised as success', async () => {
    const ctx1 = await buildSut();
    ctx1.prisma._client.payment.findUnique.mockResolvedValueOnce({
      id: 'p1', bookingId: 'b1', amount: 100, status: 'SUCCESS',
    });
    const r1 = await ctx1.sut.handleCallback({ err_code: '00',  basket_id: 'B1', Response_Key: 'x' });
    expect(r1.status).toBe('success');

    const ctx2 = await buildSut();
    ctx2.prisma._client.payment.findUnique.mockResolvedValueOnce({
      id: 'p1', bookingId: 'b1', amount: 100, status: 'SUCCESS',
    });
    const r2 = await ctx2.sut.handleCallback({ err_code: '000', basket_id: 'B1', Response_Key: 'x' });
    expect(r2.status).toBe('success');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getPaymentStatus
// ═══════════════════════════════════════════════════════════════════════════

describe('PaymentService.getPaymentStatus', () => {
  test('404 when booking missing', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce(null);
    await expect(ctx.sut.getPaymentStatus('b-missing', 'u1'))
      .rejects.toThrow(NotFoundException);
  });

  test('404 when booking belongs to someone else (IDOR collapsed to 404)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce(null);
    await expect(ctx.sut.getPaymentStatus('b1', 'u1'))
      .rejects.toThrow(NotFoundException);
    expect(ctx.prisma._client.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'b1', customerId: 'u1' }) }),
    );
  });

  test('returns NO_PAYMENT shape when booking has no paymentId', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce({
      id: 'b1', status: 'PENDING', paymentId: null,
    });
    const r = await ctx.sut.getPaymentStatus('b1', 'u1');
    expect(r).toEqual({ status: 'NO_PAYMENT' });
  });

  test('returns payment status + mapped error message for known err_code', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce({
      id: 'b1', status: 'PENDING', paymentId: 'p1',
    });
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce({
      status: 'FAILED', method: 'PAY2M', paidAt: null, gatewayErrCode: '54',
    });
    const r = await ctx.sut.getPaymentStatus('b1', 'u1');
    expect(r.status).toBe('FAILED');
    expect(r.errorMessage).toMatch(/card has expired/i);
  });

  test('unknown err_code → falls back to generic friendly message', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce({
      id: 'b1', status: 'PENDING', paymentId: 'p1',
    });
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce({
      status: 'FAILED', method: 'PAY2M', paidAt: null, gatewayErrCode: '99999',
    });
    const r = await ctx.sut.getPaymentStatus('b1', 'u1');
    expect(r.errorMessage).toMatch(/could not be processed/i);
    // Must never include the raw gateway code
    expect(r.errorMessage).not.toContain('99999');
  });

  test('no err_code → errorMessage undefined (not "undefined" string)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce({
      id: 'b1', status: 'PENDING', paymentId: 'p1',
    });
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce({
      status: 'SUCCESS', method: 'PAY2M', paidAt: new Date(), gatewayErrCode: null,
    });
    const r = await ctx.sut.getPaymentStatus('b1', 'u1');
    expect(r.errorMessage).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// handleCallback — NAPS-rail HOLD semantics
//
// A verified NAPS success is AUTHENTIC (secret-gated hash) but capture-
// ambiguous: the rail can sign "00" pre-capture (basket 939bd325 booked with
// no money under #369) AND post-capture (Apple Pay/Fawran lost bookings under
// #370). So handleCallback must neither confirm nor delete — it holds the
// payment+booking PENDING, extends the reservation, audits, and returns
// 'pending'. Confirmation arrives in a follow-up (IPN/status inquiry).
// ═══════════════════════════════════════════════════════════════════════════

/** NAPS/QPay rail Response_Key: SHA256(merchant + basket + secret + err + amount). */
function buildResponseKeyNaps(basketId: string, amount: string, errCode: string): string {
  const raw = `${PAY2M_CFG.PAY2M_MERCHANT_ID}${basketId}${PAY2M_CFG.PAY2M_SECRET_WORD}${errCode}${amount}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

describe('PaymentService.handleCallback — NAPS-rail hold', () => {
  test('verified NAPS success (PENDING payment) → held: returns pending, NO confirm/delete tx, audit row, reservation extended', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce({
      id: 'p1', bookingId: 'b1', amount: 1, status: 'PENDING',
      bookingSnapshot: null, bookingRecreatedAt: null,
      booking: { couponCode: null, couponDiscount: null, status: 'PENDING', cancelledBy: null },
    });

    // Real NAPS shape: field echoes "001", hash signed err"00"+integer amount.
    const r = await ctx.sut.handleCallback({
      err_code: '001', basket_id: 'JDWL-NAPS-HOLD',
      Response_Key: buildResponseKeyNaps('JDWL-NAPS-HOLD', '1', '00'),
    });

    expect(r).toEqual({ bookingId: 'b1', status: 'pending' });
    // Neither the confirm nor the delete transaction may run.
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    // Booking reservation extended — forward-only, PENDING-only guard in the where.
    expect(ctx.prisma._client.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'b1', status: 'PENDING' }),
        data: { reservedUntil: expect.any(Date) },
      }),
    );
    // Audited as awaiting capture — not as success, not as failure.
    expect(ctx.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYMENT_NAPS_AWAITING_CAPTURE', actionCategory: 'FINANCIAL' }),
    );
    expect(ctx.audit.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYMENT_SUCCESS' }),
    );
  });

  test('verified NAPS success on a cron-FAILED payment → held (no recovery on capture-ambiguous signal)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce({
      id: 'p1', bookingId: 'b1', amount: 1, status: 'FAILED',
      bookingSnapshot: null, bookingRecreatedAt: null,
      booking: { couponCode: null, couponDiscount: null, status: 'PENDING', cancelledBy: null },
    });

    const r = await ctx.sut.handleCallback({
      err_code: '001', basket_id: 'JDWL-NAPS-LATE',
      Response_Key: buildResponseKeyNaps('JDWL-NAPS-LATE', '1', '00'),
    });

    expect(r).toEqual({ bookingId: 'b1', status: 'pending' });
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    expect(ctx.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYMENT_NAPS_AWAITING_CAPTURE' }),
    );
  });

  test('verified NAPS FAILURE (901 customer-cancel) → normal failure path runs (cleanup allowed)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce({
      id: 'p1', bookingId: 'b1', amount: 100, status: 'PENDING',
      bookingSnapshot: null, bookingRecreatedAt: null,
      booking: { couponCode: null, couponDiscount: null, status: 'PENDING', cancelledBy: null },
    });
    // The failure tx deletes payment+booking; the $transaction mock executes
    // the callback against the model mocks, so just let it run.
    ctx.prisma._client.payment.updateMany.mockResolvedValueOnce({ count: 1 });
    ctx.prisma._client.booking.findUnique.mockResolvedValueOnce({
      activityId: 'act1', customerId: 'u1', couponCode: null,
    });

    const r = await ctx.sut.handleCallback({
      err_code: '901', basket_id: 'JDWL-NAPS-FAIL',
      Response_Key: buildResponseKeyNaps('JDWL-NAPS-FAIL', '100', '901'),
    });

    expect(r.status).toBe('failed');
    expect(ctx.prisma.$transaction).toHaveBeenCalled(); // cleanup ran
    expect(ctx.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYMENT_FAILED' }),
    );
    expect(ctx.audit.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYMENT_NAPS_AWAITING_CAPTURE' }),
    );
  });

  test('SECURITY: forged callback (random key) is still rejected — accepting the NAPS order opens no forgery hole', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce({
      id: 'p1', bookingId: 'b1', amount: 1, status: 'PENDING',
      bookingSnapshot: null, bookingRecreatedAt: null,
      booking: { couponCode: null, couponDiscount: null, status: 'PENDING', cancelledBy: null },
    });

    await expect(ctx.sut.handleCallback({
      err_code: '001', basket_id: 'JDWL-NAPS-FORGED', Response_Key: 'a'.repeat(64),
    })).rejects.toThrow(/verification failed/i);

    expect(ctx.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYMENT_HASH_MISMATCH' }),
    );
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  test('card success is UNCHANGED by the rail logic (amount+err order still confirms; already-SUCCESS idempotent)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce({
      id: 'p1', bookingId: 'b1', amount: 100, status: 'SUCCESS',
    });
    const r = await ctx.sut.handleCallback({
      err_code: '00', basket_id: 'B1', Response_Key: buildResponseKey('B1', '100.00', '00'),
    });
    expect(r).toEqual({ bookingId: 'b1', status: 'success' });
  });
});
