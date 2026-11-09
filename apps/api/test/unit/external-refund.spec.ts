/**
 * "Refund already done outside the website": the shared rules and copy in
 * common/refunds/external-refund.ts, and the DTO shape on both endpoints.
 *
 * Covers what the integration specs cannot pin cheaply: the refund date is
 * judged against today on BOTH the activity's clock and the admin panel's
 * clock (Qatar), the audit details keep the structured fields ahead of any
 * free text, and a non-object externalRefund is rejected at validation.
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import {
  ADMIN_PANEL_TZ, assertExternalRefundAllowed, externalRefundAuditDetails, externalRefundCancelMessage,
  externalRefundDecisionMessage, externalRefundNote, formatRefundDate, latestToday, todayIn,
} from '../../src/common/refunds/external-refund';
import { UpdateBookingStatusDto } from '../../src/admin/dto/update-booking-status.dto';
import { RefundDecisionDto } from '../../src/bookings/dto/refund-decision.dto';

const REFUND = { method: 'BANK_TRANSFER' as const, amount: 105, refundedOn: '2026-11-01', reference: 'TRF-123' };

describe('assertExternalRefundAllowed — refund date vs "today"', () => {
  afterEach(() => jest.useRealTimers());

  test('admin panel clock is Qatar', () => {
    expect(ADMIN_PANEL_TZ).toBe('Asia/Qatar');
  });

  test('22:30 UTC: it is already tomorrow in Qatar, so the Qatar date is accepted for a UTC activity', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-08T22:30:00.000Z'));
    expect(todayIn('UTC')).toBe('2026-11-08');
    expect(todayIn('Asia/Qatar')).toBe('2026-11-09');
    expect(latestToday('UTC')).toBe('2026-11-09');
    // The web pre-fills "today in Qatar"; the server must not call it a future date.
    expect(() => assertExternalRefundAllowed({ ...REFUND, refundedOn: '2026-11-09' }, 105, 'UTC')).not.toThrow();
    expect(() => assertExternalRefundAllowed({ ...REFUND, refundedOn: '2026-11-10' }, 105, 'UTC')).toThrow(/cannot be in the future/);
  });

  test('20:30 UTC: an activity ahead of Qatar (Dubai) is already on tomorrow; that day is accepted too', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-08T20:30:00.000Z'));
    expect(todayIn('Asia/Qatar')).toBe('2026-11-08');
    expect(todayIn('Asia/Dubai')).toBe('2026-11-09');
    expect(latestToday('Asia/Dubai')).toBe('2026-11-09');
    expect(() => assertExternalRefundAllowed({ ...REFUND, refundedOn: '2026-11-09' }, 105, 'Asia/Dubai')).not.toThrow();
    expect(() => assertExternalRefundAllowed({ ...REFUND, refundedOn: '2026-11-10' }, 105, 'Asia/Dubai')).toThrow(/cannot be in the future/);
  });

  test('midday: both clocks agree and tomorrow is refused', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-08T09:00:00.000Z'));
    expect(latestToday('Asia/Qatar')).toBe('2026-11-08');
    expect(() => assertExternalRefundAllowed({ ...REFUND, refundedOn: '2026-11-08' }, 105, 'Asia/Qatar')).not.toThrow();
    expect(() => assertExternalRefundAllowed({ ...REFUND, refundedOn: '2026-11-09' }, 105, 'Asia/Qatar')).toThrow(BadRequestException);
  });

  test('cash, amount and real-date rules', () => {
    expect(() => assertExternalRefundAllowed(REFUND, 0, 'Asia/Qatar')).toThrow(/paid by card/);
    expect(() => assertExternalRefundAllowed({ ...REFUND, amount: 0 }, 105, 'Asia/Qatar')).toThrow(/above 0/);
    expect(() => assertExternalRefundAllowed({ ...REFUND, amount: 105.01 }, 105, 'Asia/Qatar')).toThrow(/cannot exceed the cash paid \(105\)/);
    expect(() => assertExternalRefundAllowed({ ...REFUND, refundedOn: '2026-02-30' }, 105, 'Asia/Qatar')).toThrow(/not a valid date/);
    // Two-decimal amounts that are inexact in doubles are fine on the server too.
    expect(() => assertExternalRefundAllowed({ ...REFUND, amount: 1.15 }, 105, 'Asia/Qatar')).not.toThrow();
  });
});

describe('copy and audit details', () => {
  test('note, dates and customer message', () => {
    expect(externalRefundNote(REFUND)).toBe('Refunded outside the website: QAR 105 by Bank transfer on 1 Nov 2026. Ref: TRF-123');
    expect(externalRefundNote({ ...REFUND, reference: '  ' })).toBe('Refunded outside the website: QAR 105 by Bank transfer on 1 Nov 2026.');
    expect(formatRefundDate('2026-11-01', 'EN')).toBe('1 Nov 2026');
    expect(formatRefundDate('2026-11-01', 'AR')).toMatch(/2026/); // Western digits, Arabic month name
    expect(formatRefundDate('2026-11-01', 'AR')).not.toMatch(/[٠-٩]/);
    const ar = externalRefundCancelMessage({ lang: 'AR', ref: 'JDWL-1', titleEn: 'Tour', titleAr: 'جولة', refund: { ...REFUND, method: 'CASH' } });
    expect(ar.message).toContain('نقداً');
    expect(ar.message).toContain('(جولة)');
    expect(ar.message).not.toMatch(/Wanasa|وناسة/);
    // English customers read the booking page's words, not the admin vocabulary (no gateway name, no "Other").
    const en = externalRefundCancelMessage({ lang: 'EN', ref: 'JDWL-1', titleEn: 'Tour', refund: { ...REFUND, method: 'CARD_PAY2M' } });
    expect(en.message).toBe('Booking JDWL-1 for "Tour" was cancelled by AL Jadwal support. Your refund of QAR 105 was made by card refund on 1 Nov 2026.');
    expect(externalRefundDecisionMessage({ lang: 'EN', ref: 'JDWL-1', titleEn: 'Tour', refund: { ...REFUND, method: 'OTHER' } }).message)
      .toBe('Your refund of QAR 105 for booking JDWL-1 ("Tour") was made by another method on 1 Nov 2026.');
    expect(externalRefundNote({ ...REFUND, method: 'CARD_PAY2M' })).toContain('by Card refund in PAY2M'); // admin note keeps the admin label
  });

  test('audit details keep the structured fields first; a long note cannot push them past the 1000-char cap', () => {
    const details = externalRefundAuditDetails(REFUND, { note: 'x'.repeat(300), activityTitle: 'y'.repeat(200), refundAmountQAR: 105, refundPoints: 0 });
    expect(details.length).toBeLessThanOrEqual(1000);
    expect(JSON.parse(details)).toMatchObject({ refundedOutside: true, method: 'BANK_TRANSFER', amount: 105, refundedOn: '2026-11-01', reference: 'TRF-123', refundAmountQAR: 105 });
    // Even with an absurd extra, the fields that matter are at the front of the string.
    const huge = externalRefundAuditDetails(REFUND, { note: 'x'.repeat(2000) });
    expect(huge.length).toBe(1000);
    expect(huge.indexOf('"reference":"TRF-123"')).toBeGreaterThan(0);
    expect(huge.indexOf('"reference":"TRF-123"')).toBeLessThan(200);
  });
});

describe('externalRefund DTO shape (both endpoints)', () => {
  async function errorsFor(cls: new () => object, body: Record<string, unknown>) {
    const dto = plainToInstance(cls, body) as object;
    const errs = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    return errs.map((e) => e.property);
  }

  test.each([
    ['admin status', UpdateBookingStatusDto, { status: 'CANCELLED' }],
    ['refund decision', RefundDecisionDto, { action: 'APPROVE' }],
  ])('%s: an object passes, an array / empty array / string are rejected', async (_n, cls, base) => {
    expect(await errorsFor(cls, { ...base, externalRefund: REFUND })).toEqual([]);
    expect(await errorsFor(cls, { ...base })).toEqual([]);
    expect(await errorsFor(cls, { ...base, externalRefund: [REFUND] })).toEqual(['externalRefund']);
    expect(await errorsFor(cls, { ...base, externalRefund: [] })).toEqual(['externalRefund']);
    expect(await errorsFor(cls, { ...base, externalRefund: 'BANK_TRANSFER' })).toEqual(['externalRefund']);
    expect(await errorsFor(cls, { ...base, externalRefund: { ...REFUND, method: 'CRYPTO' } })).toEqual(['externalRefund']);
  });
});
