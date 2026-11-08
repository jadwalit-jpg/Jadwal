import { BadRequestException } from '@nestjs/common';
import { nowInTimezone } from '../validators/timezone';
import type { ExternalRefundDto, RefundMethodValue } from '../dto/external-refund.dto';

/**
 * Shared rules and copy for "refund already done outside the website".
 * Used by the admin cancel (AdminService.updateBookingStatus) and the admin
 * approve in the refund queue (BookingsService.recordRefundDecision), so the
 * two paths validate, record and word things identically.
 */

export const REFUND_METHOD_LABEL_EN: Record<RefundMethodValue, string> = {
  BANK_TRANSFER: 'Bank transfer',
  CASH: 'Cash',
  CARD_PAY2M: 'Card refund in PAY2M',
  OTHER: 'Other',
};

export const REFUND_METHOD_LABEL_AR: Record<RefundMethodValue, string> = {
  BANK_TRANSFER: 'تحويل بنكي',
  CASH: 'نقداً',
  CARD_PAY2M: 'استرداد على البطاقة',
  OTHER: 'طريقة أخرى',
};

/**
 * What the CUSTOMER reads in English, mid-sentence ("was made by bank
 * transfer"). Same words as the booking page (web locales, booking.refundMethod),
 * so the notification and the page describe one refund the same way. The admin
 * vocabulary above (gateway name, capitals) stays admin-only. Arabic has one
 * vocabulary for both.
 */
export const REFUND_METHOD_CUSTOMER_EN: Record<RefundMethodValue, string> = {
  BANK_TRANSFER: 'bank transfer',
  CASH: 'cash',
  CARD_PAY2M: 'card refund',
  OTHER: 'another method',
};

export type Lang = 'EN' | 'AR';

/** Admin-facing label (notes, admin responses). */
export function refundMethodLabel(method: RefundMethodValue, lang: Lang): string {
  return (lang === 'AR' ? REFUND_METHOD_LABEL_AR : REFUND_METHOD_LABEL_EN)[method] ?? method;
}

/** Customer-facing label for the notification texts. */
export function customerRefundMethodLabel(method: RefundMethodValue, lang: Lang): string {
  return (lang === 'AR' ? REFUND_METHOD_LABEL_AR : REFUND_METHOD_CUSTOMER_EN)[method] ?? method;
}

/** Today's calendar date (YYYY-MM-DD) in the given IANA timezone. */
export function todayIn(tz: string): string {
  return nowInTimezone(tz).toISOString().slice(0, 10);
}

/**
 * The admin panel's clock. The web pre-fills and caps the refund date with
 * "today in Qatar" (`todayInQatar()` in external-refund-fields.tsx), so the
 * server must accept that day too, even for an activity whose country
 * timezone is behind Qatar (the schema default is UTC): otherwise an admin
 * recording a same-day refund shortly after midnight Qatar time gets a 400
 * for a date the form will not let them change.
 */
export const ADMIN_PANEL_TZ = 'Asia/Qatar';

/** Latest calendar day that counts as "today": in the activity's timezone or on the admin panel's clock. */
export function latestToday(activityTz: string): string {
  const a = todayIn(activityTz);
  const b = todayIn(ADMIN_PANEL_TZ);
  return a > b ? a : b;
}

/** `refundedOn` as the stored DateTime: that calendar day, tagged UTC like every other date in the schema. */
export function refundedOnAsDate(refundedOn: string): Date {
  return new Date(`${refundedOn}T00:00:00.000Z`);
}

function isRealDate(ymd: string): boolean {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
}

/**
 * Business rules an outside refund must satisfy, checked against the live
 * payment row. Throws BadRequestException with a clear message. The date may
 * not be after today in the activity's timezone or on the admin panel's clock
 * (whichever is later), see ADMIN_PANEL_TZ.
 */
export function assertExternalRefundAllowed(
  refund: ExternalRefundDto,
  /** Cash the customer actually paid by card: 0 for unpaid and points-only bookings. */
  cashPaid: number,
  tz: string,
): void {
  if (!(cashPaid > 0)) {
    throw new BadRequestException(
      'An outside refund can only be recorded on a booking paid by card (unpaid and points-only bookings have no cash to refund)',
    );
  }
  if (!(refund.amount > 0)) {
    throw new BadRequestException('Refund amount must be above 0');
  }
  if (refund.amount > cashPaid + 1e-9) {
    throw new BadRequestException(`Refund amount cannot exceed the cash paid (${cashPaid})`);
  }
  if (!isRealDate(refund.refundedOn)) {
    throw new BadRequestException('Refund date is not a valid date');
  }
  if (refund.refundedOn > latestToday(tz)) {
    throw new BadRequestException('Refund date cannot be in the future');
  }
}

/** Date as shown to people: 20 Nov 2026 (EN) / 20 نوفمبر 2026 (AR). */
export function formatRefundDate(refundedOn: string, lang: Lang): string {
  const d = refundedOnAsDate(refundedOn);
  return d.toLocaleDateString(lang === 'AR' ? 'ar-QA' : 'en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    // Western digits in Arabic too, matching the rest of the site's Arabic copy.
    numberingSystem: 'latn',
  } as Intl.DateTimeFormatOptions);
}

/** refundDecisionNote for an outside refund (English; it is an admin-facing record). */
export function externalRefundNote(refund: ExternalRefundDto): string {
  const base = `Refunded outside the website: QAR ${formatAmount(refund.amount)} by ${REFUND_METHOD_LABEL_EN[refund.method]} on ${formatRefundDate(refund.refundedOn, 'EN')}.`;
  const ref = refund.reference?.trim();
  return (ref ? `${base} Ref: ${ref}` : base).slice(0, 1000);
}

export function formatAmount(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/**
 * Customer notification for a cancellation with an outside refund, in the
 * customer's language. Never mentions Wanasa points for the cash part.
 */
export function externalRefundCancelMessage(input: {
  lang: Lang;
  ref: string;
  titleEn: string;
  titleAr?: string | null;
  refund: ExternalRefundDto;
}): { title: string; message: string } {
  const { lang, ref, refund } = input;
  const amount = formatAmount(refund.amount);
  const method = customerRefundMethodLabel(refund.method, lang);
  const date = formatRefundDate(refund.refundedOn, lang);
  if (lang === 'AR') {
    const title = input.titleAr || input.titleEn;
    return {
      title: 'تم إلغاء حجزك',
      message: `تم إلغاء حجزك رقم ${ref} (${title}) من فريق الجدول، وتم رد مبلغ ${amount} ر.ق لك عن طريق ${method} بتاريخ ${date}.`,
    };
  }
  return {
    title: 'Your booking was cancelled',
    message: `Booking ${ref} for "${input.titleEn}" was cancelled by AL Jadwal support. Your refund of QAR ${amount} was made by ${method} on ${date}.`,
  };
}

/** Customer notification when an admin approves a refund request as already refunded outside. */
export function externalRefundDecisionMessage(input: {
  lang: Lang;
  ref: string;
  titleEn: string;
  titleAr?: string | null;
  refund: ExternalRefundDto;
}): { title: string; message: string } {
  const { lang, ref, refund } = input;
  const amount = formatAmount(refund.amount);
  const method = customerRefundMethodLabel(refund.method, lang);
  const date = formatRefundDate(refund.refundedOn, lang);
  if (lang === 'AR') {
    const title = input.titleAr || input.titleEn;
    return {
      title: 'تم رد المبلغ',
      message: `تم رد مبلغ ${amount} ر.ق لك عن حجزك رقم ${ref} (${title}) عن طريق ${method} بتاريخ ${date}.`,
    };
  }
  return {
    title: 'Your refund was made',
    message: `Your refund of QAR ${amount} for booking ${ref} ("${input.titleEn}") was made by ${method} on ${date}.`,
  };
}

/** Audit details for either path. */
export function externalRefundAuditDetails(refund: ExternalRefundDto, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    refundedOutside: true,
    method: refund.method,
    amount: refund.amount,
    refundedOn: refund.refundedOn,
    reference: refund.reference?.trim() || null,
    ...extra,
  }).slice(0, 1000);
}
