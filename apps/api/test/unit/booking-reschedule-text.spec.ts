import {
  describeBookingWindow,
  bookingWindowTexts,
  customerRescheduledMessage,
  vendorRescheduledMessage,
  rescheduleAuditDetails,
} from '../../src/admin/booking-reschedule.text';
import { bookingRescheduledTemplate } from '../../src/email/templates/booking-rescheduled';
import { vendorBookingRescheduledTemplate } from '../../src/email/templates/vendor-booking-rescheduled';

// Booking times are local wall-clock tagged UTC.
const hourlyFrom = { start: new Date('2026-12-20T10:00:00.000Z'), end: new Date('2026-12-20T12:00:00.000Z') };
const hourlyTo = { start: new Date('2026-12-21T14:00:00.000Z'), end: new Date('2026-12-21T16:00:00.000Z') };
const stayFrom = { start: new Date('2026-12-20T14:00:00.000Z'), end: new Date('2026-12-22T11:00:00.000Z') };

describe('describeBookingWindow', () => {
  it('hourly: date and the time range, read in UTC', () => {
    expect(describeBookingWindow(hourlyFrom.start, hourlyFrom.end, 'HOURLY', 'EN')).toBe('Sun, 20 Dec 2026, 10:00–12:00');
  });
  it('daily: check-in → check-out with the night count', () => {
    expect(describeBookingWindow(stayFrom.start, stayFrom.end, 'DAILY', 'EN')).toBe('Sun, 20 Dec 2026 → Tue, 22 Dec 2026 (2 nights)');
    expect(describeBookingWindow(stayFrom.start, new Date('2026-12-21T11:00:00.000Z'), 'DAILY', 'EN')).toContain('(1 night)');
  });
  it('arabic uses Arabic month and weekday names with Latin digits', () => {
    const ar = describeBookingWindow(hourlyFrom.start, hourlyFrom.end, 'HOURLY', 'AR');
    expect(ar).toContain('2026');
    expect(ar).toContain('10:00');
    expect(ar).toMatch(/ديسمبر/);
    expect(ar).not.toMatch(/[٠-٩]/);
    expect(describeBookingWindow(stayFrom.start, stayFrom.end, 'DAILY', 'AR')).toContain('ليلتان');
  });
});

describe('messages', () => {
  const texts = bookingWindowTexts(hourlyFrom, hourlyTo, 'HOURLY', 'EN');
  it('customer EN names the booking, the new and the old window', () => {
    const m = customerRescheduledMessage({ lang: 'EN', ref: 'JDWL-ABC12', titleEn: 'Desert Tour', texts });
    expect(m.title).toBe('Your booking date was changed');
    expect(m.message).toContain('JDWL-ABC12');
    expect(m.message).toContain('is now on Mon, 21 Dec 2026, 14:00–16:00');
    expect(m.message).toContain('It was on Sun, 20 Dec 2026, 10:00–12:00');
  });
  it('customer AR uses the Arabic title and falls back to English when missing', () => {
    const ar = bookingWindowTexts(hourlyFrom, hourlyTo, 'HOURLY', 'AR');
    expect(customerRescheduledMessage({ lang: 'AR', ref: 'R', titleEn: 'Desert Tour', titleAr: 'جولة', texts: ar }).message).toContain('"جولة"');
    expect(customerRescheduledMessage({ lang: 'AR', ref: 'R', titleEn: 'Desert Tour', titleAr: null, texts: ar }).message).toContain('"Desert Tour"');
  });
  it('vendor message names the customer, never the reason', () => {
    const m = vendorRescheduledMessage({ lang: 'EN', ref: 'JDWL-1', titleEn: 'Desert Tour', customerName: 'Noor', texts });
    expect(m.title).toBe('Booking date changed');
    expect(m.message).toContain('(Noor)');
    expect(m.message).toContain('from Sun, 20 Dec 2026, 10:00–12:00 to Mon, 21 Dec 2026, 14:00–16:00');
  });
  it('audit details: dates, unit change, money and settlement; "no money moved" for 0', () => {
    const d = rescheduleAuditDetails({ ref: 'JDWL-1', texts, fromUnit: 1, toUnit: 2, priceBefore: 800, priceAfter: 900, difference: 100, currency: 'QAR', settlement: 'PAID_OUTSIDE', settlementRef: 'TRF 1' });
    expect(d).toBe('Booking JDWL-1 moved from Sun, 20 Dec 2026, 10:00–12:00 to Mon, 21 Dec 2026, 14:00–16:00, unit 1 → 2; price QAR 800.00 → 900.00 (difference +100.00); PAID_OUTSIDE ref TRF 1');
    expect(rescheduleAuditDetails({ ref: 'R', texts, fromUnit: null, toUnit: null, priceBefore: 200, priceAfter: 200, difference: 0, currency: 'QAR', settlement: null, settlementRef: null })).toContain('no money moved');
    expect(rescheduleAuditDetails({ ref: 'R', texts, fromUnit: 1, toUnit: 1, priceBefore: 200, priceAfter: 150, difference: -50, currency: 'QAR', settlement: 'WAIVED', settlementRef: null })).toContain(', unit 1; price QAR 200.00 → 150.00 (difference -50.00); WAIVED');
  });
});

describe('email templates', () => {
  const data = {
    customerName: 'Noor <b>',
    bookingRef: 'JDWL-ABC12',
    bookingId: 'b-1',
    activityTitle: 'Desert & Dunes',
    activityTitleAr: 'الصحراء',
    fromText: 'Sun, 20 Dec 2026, 10:00–12:00',
    toText: 'Mon, 21 Dec 2026, 14:00–16:00',
    fromTextAr: 'الأحد 20 ديسمبر 2026، 10:00–12:00',
    toTextAr: 'الاثنين 21 ديسمبر 2026، 14:00–16:00',
  };
  it('customer EN: subject with the reference, both windows, escaped, link to the booking', () => {
    const r = bookingRescheduledTemplate(data, 'EN');
    expect(r.subject).toBe('Your booking JDWL-ABC12 has new dates — AL Jadwal');
    expect(r.html).toContain('Noor &lt;b&gt;');
    expect(r.html).toContain('Desert &amp; Dunes');
    expect(r.html).toContain(data.fromText);
    expect(r.html).toContain(data.toText);
    expect(r.html).toContain('{{APP_URL}}/bookings/b-1');
    expect(r.text).toContain(`Now: ${data.toText}`);
    expect(r.html).not.toContain('undefined');
  });
  it('customer AR: Arabic title and windows, /ar link, rtl document', () => {
    const r = bookingRescheduledTemplate(data, 'AR');
    expect(r.subject).toContain('JDWL-ABC12');
    expect(r.html).toContain('الصحراء');
    expect(r.html).toContain(data.toTextAr);
    expect(r.html).not.toContain(data.toText);
    expect(r.html).toContain('{{APP_URL}}/ar/bookings/b-1');
    expect(r.html).toMatch(/dir="rtl"/);
  });
  it('vendor: customer name and phone, guests, both windows, bookings link; no email address field', () => {
    const r = vendorBookingRescheduledTemplate({ ...data, vendorName: 'Sealine Camp', vendorSlug: 'sealine', customerName: 'Noor', customerPhone: '+97455123456', guests: 4 }, 'EN');
    expect(r.subject).toBe('Booking JDWL-ABC12 moved to new dates — AL Jadwal');
    expect(r.html).toContain('Sealine Camp');
    expect(r.html).toContain('+97455123456');
    expect(r.html).toContain('>4<');
    expect(r.html).toContain('{{APP_URL}}/vendor/sealine/bookings');
    expect(r.text).toContain('Guests: 4');
    expect(r.html).not.toContain('@');
    const ar = vendorBookingRescheduledTemplate({ ...data, vendorName: 'V', vendorSlug: 's', customerName: 'Noor', customerPhone: '+974', guests: 1 }, 'AR');
    expect(ar.html).toContain('تم تغيير تاريخ حجز');
    expect(ar.html).toContain(data.toTextAr);
  });
});
