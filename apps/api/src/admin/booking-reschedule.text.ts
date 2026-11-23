/**
 * Human-readable text for an admin date change: the booked window before and
 * after, in English or Arabic, for notifications, emails and the audit log.
 *
 * Booking datetimes are stored as the activity's local wall-clock time tagged
 * UTC (see buildDatetime), so every formatter here reads them with
 * timeZone 'UTC'. Latin digits in Arabic too: references and times are read
 * aloud to customers over the phone and must match what the admin sees.
 */

export type BookingWindowLang = 'EN' | 'AR';

const DATE_LOCALE: Record<BookingWindowLang, string> = { EN: 'en-GB', AR: 'ar-QA-u-nu-latn' };

export function formatBookingDate(d: Date, lang: BookingWindowLang): string {
  return new Intl.DateTimeFormat(DATE_LOCALE[lang], {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(d);
}

export function formatBookingTime(d: Date, lang: BookingWindowLang): string {
  return new Intl.DateTimeFormat(DATE_LOCALE[lang], {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
  }).format(d);
}

/**
 * "Sat, 20 Dec 2026, 10:00–12:00" for an hourly booking;
 * "Sat, 20 Dec 2026 → Mon, 22 Dec 2026 (2 nights)" for a stay.
 */
export function describeBookingWindow(
  start: Date,
  end: Date,
  bookingType: 'HOURLY' | 'DAILY' | string,
  lang: BookingWindowLang,
): string {
  if (bookingType === 'HOURLY') {
    return `${formatBookingDate(start, lang)}, ${formatBookingTime(start, lang)}–${formatBookingTime(end, lang)}`;
  }
  const nights = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  const nightsText = lang === 'AR'
    ? (nights === 1 ? 'ليلة واحدة' : nights === 2 ? 'ليلتان' : nights <= 10 ? `${nights} ليالٍ` : `${nights} ليلة`)
    : `${nights} night${nights === 1 ? '' : 's'}`;
  return `${formatBookingDate(start, lang)} → ${formatBookingDate(end, lang)} (${nightsText})`;
}

export type BookingWindowTexts = { from: string; to: string };

export function bookingWindowTexts(
  from: { start: Date; end: Date },
  to: { start: Date; end: Date },
  bookingType: string,
  lang: BookingWindowLang,
): BookingWindowTexts {
  return {
    from: describeBookingWindow(from.start, from.end, bookingType, lang),
    to: describeBookingWindow(to.start, to.end, bookingType, lang),
  };
}

/** In-app notification for the customer whose booking an admin moved. */
export function customerRescheduledMessage(params: {
  lang: BookingWindowLang;
  ref: string;
  titleEn: string;
  titleAr?: string | null;
  texts: BookingWindowTexts;
}): { title: string; message: string } {
  if (params.lang === 'AR') {
    const title = params.titleAr || params.titleEn;
    return {
      title: 'تم تغيير تاريخ حجزك',
      message: `أصبح حجزك ${params.ref} لنشاط "${title}" في ${params.texts.to}. كان في ${params.texts.from}. تواصل مع دعم AL Jadwal إن كان لديك أي سؤال.`,
    };
  }
  return {
    title: 'Your booking date was changed',
    message: `Booking ${params.ref} for "${params.titleEn}" is now on ${params.texts.to}. It was on ${params.texts.from}. Contact AL Jadwal support if you have any question.`,
  };
}

/** In-app notification for the vendor of a moved booking. */
export function vendorRescheduledMessage(params: {
  lang: BookingWindowLang;
  ref: string;
  titleEn: string;
  titleAr?: string | null;
  customerName: string;
  texts: BookingWindowTexts;
}): { title: string; message: string } {
  if (params.lang === 'AR') {
    const title = params.titleAr || params.titleEn;
    return {
      title: 'تم تغيير تاريخ حجز',
      message: `نقل فريق AL Jadwal حجز ${params.ref} (${params.customerName}) لنشاط "${title}" من ${params.texts.from} إلى ${params.texts.to}.`,
    };
  }
  return {
    title: 'Booking date changed',
    message: `AL Jadwal support moved booking ${params.ref} (${params.customerName}) for "${params.titleEn}" from ${params.texts.from} to ${params.texts.to}.`,
  };
}

/** Audit-log summary. No customer data: reference, dates, unit, money, settlement only. */
export function rescheduleAuditDetails(params: {
  ref: string;
  texts: BookingWindowTexts;
  fromUnit: number | null;
  toUnit: number | null;
  priceBefore: number;
  priceAfter: number;
  difference: number;
  currency: string;
  settlement: string | null;
  settlementRef: string | null;
}): string {
  const unit = params.fromUnit === params.toUnit
    ? (params.toUnit == null ? '' : `, unit ${params.toUnit}`)
    : `, unit ${params.fromUnit ?? '—'} → ${params.toUnit ?? '—'}`;
  const money = `${params.currency} ${params.priceBefore.toFixed(2)} → ${params.priceAfter.toFixed(2)} (difference ${params.difference >= 0 ? '+' : ''}${params.difference.toFixed(2)})`;
  const settled = params.difference === 0
    ? 'no money moved'
    : `${params.settlement ?? 'unsettled'}${params.settlementRef ? ` ref ${params.settlementRef}` : ''}`;
  return `Booking ${params.ref} moved from ${params.texts.from} to ${params.texts.to}${unit}; price ${money}; ${settled}`;
}
