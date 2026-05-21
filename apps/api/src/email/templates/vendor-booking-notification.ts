import { baseTemplate, escapeHtml, ctaButton, type RenderedEmail } from './base';
import type { EmailLanguage } from '../../common/utils/locale';

/**
 * Vendor booking-notification email — sent to the owning vendor when one of
 * their activities is booked (and paid for, or fully covered by Wanasa points).
 *
 * PII contract (audited 2026-05-21):
 *   The body includes the customer's NAME and PHONE only — enough for the
 *   vendor to coordinate the booking. The customer's email is deliberately
 *   omitted (PDPPL data minimisation). If a vendor needs to email the
 *   customer, they open the booking in the dashboard where access is gated.
 */
export interface VendorBookingNotificationData {
  /** Vendor's User.fullName — greeting target. */
  vendorName: string;
  /** Booking reference (e.g. "JDW-A1B2C3") — short, human-readable. */
  bookingRef: string;
  /** Booking PK — used in the dashboard deep-link. */
  bookingId: string;
  /** Vendor slug — `/vendor/<slug>/bookings/<id>` deep-link. */
  vendorSlug: string;
  activityTitle: string;
  date: string;
  time?: string;
  guests: number;
  totalAmount: string;
  currency: string;
  customerName: string;
  customerPhone: string;
  locationAddress?: string;
}

const STRINGS: Record<
  EmailLanguage,
  {
    subject: (ref: string, guests: number) => string;
    heading: string;
    greeting: (name: string) => string;
    preview: (activity: string) => string;
    labels: {
      reference: string;
      activity: string;
      date: string;
      time: string;
      guests: string;
      total: string;
      location: string;
      customerName: string;
      customerPhone: string;
      customerSection: string;
    };
    viewButton: string;
    questions: string;
  }
> = {
  EN: {
    subject: (ref, guests) => `New booking ${ref} — ${guests} guest${guests === 1 ? '' : 's'} | AL Jadwal`,
    heading: 'New Booking Received',
    greeting: (name) => `Hi ${name}, you have a new confirmed booking on AL Jadwal. Details below.`,
    preview: (activity) => `A customer just booked ${activity}.`,
    labels: {
      reference: 'Reference',
      activity: 'Activity',
      date: 'Date',
      time: 'Time',
      guests: 'Guests',
      total: 'Total',
      location: 'Location',
      customerName: 'Customer',
      customerPhone: 'Phone',
      customerSection: 'Customer contact',
    },
    viewButton: 'Open in dashboard',
    questions: 'Need help? Reply to this email and our team will assist.',
  },
  AR: {
    subject: (ref, guests) => `حجز جديد ${ref} — ${guests} ضيف | AL Jadwal`,
    heading: 'حجز جديد',
    greeting: (name) => `مرحبًا ${name}، لديك حجز جديد مؤكد على AL Jadwal. التفاصيل أدناه.`,
    preview: (activity) => `قام أحد العملاء بحجز ${activity}.`,
    labels: {
      reference: 'المرجع',
      activity: 'النشاط',
      date: 'التاريخ',
      time: 'الوقت',
      guests: 'الضيوف',
      total: 'الإجمالي',
      location: 'الموقع',
      customerName: 'العميل',
      customerPhone: 'الهاتف',
      customerSection: 'بيانات التواصل مع العميل',
    },
    viewButton: 'فتح في لوحة التحكم',
    questions: 'تحتاج المساعدة؟ يمكنك الرد على هذا البريد وسيساعدك فريقنا.',
  },
};

export function vendorBookingNotificationTemplate(
  data: VendorBookingNotificationData,
  locale: EmailLanguage = 'EN',
): RenderedEmail {
  const t = STRINGS[locale];
  const endAlign = locale === 'AR' ? 'left' : 'right';

  const vendorName = escapeHtml(data.vendorName);
  const bookingRef = escapeHtml(data.bookingRef);
  const activity = escapeHtml(data.activityTitle);
  const date = escapeHtml(data.date);
  const time = data.time ? escapeHtml(data.time) : null;
  const guests = escapeHtml(String(data.guests));
  const total = escapeHtml(data.totalAmount);
  const currency = escapeHtml(data.currency);
  const customerName = escapeHtml(data.customerName);
  const customerPhone = escapeHtml(data.customerPhone);
  const address = data.locationAddress ? escapeHtml(data.locationAddress) : null;
  // Slug is validated server-side at vendor creation (lowercase, hyphen, alnum
  // only) but we escape it defensively before composing the URL.
  const slugSafe = escapeHtml(data.vendorSlug);
  const bookingIdSafe = escapeHtml(data.bookingId);
  const viewUrl = `{{APP_URL}}/vendor/${slugSafe}/bookings/${bookingIdSafe}`;

  const timeRow = time
    ? `<tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">${t.labels.time}</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; border-bottom: 1px solid #f3f4f6; text-align: ${endAlign};">${time}</td>
      </tr>`
    : '';

  const locationRow = address
    ? `<tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">${t.labels.location}</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; border-bottom: 1px solid #f3f4f6; text-align: ${endAlign};">${address}</td>
      </tr>`
    : '';

  const content = `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 22px; font-weight: bold; color: #111827; padding-bottom: 8px;">
          ${t.heading}
        </td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 15px; color: #374151; padding-bottom: 24px; line-height: 22px;">
          ${t.greeting(vendorName)}
        </td>
      </tr>
    </table>

    <!-- Booking details table -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      <tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">${t.labels.reference}</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; border-bottom: 1px solid #f3f4f6; text-align: ${endAlign}; font-variant-numeric: tabular-nums;">${bookingRef}</td>
      </tr>
      <tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">${t.labels.activity}</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; border-bottom: 1px solid #f3f4f6; text-align: ${endAlign};">${activity}</td>
      </tr>
      <tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">${t.labels.date}</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; border-bottom: 1px solid #f3f4f6; text-align: ${endAlign};">${date}</td>
      </tr>
      ${timeRow}
      <tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">${t.labels.guests}</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; border-bottom: 1px solid #f3f4f6; text-align: ${endAlign};">${guests}</td>
      </tr>
      ${locationRow}
      <tr style="background-color: #f0f9ff;">
        <td style="padding: 12px 16px; font-family: Arial, sans-serif; font-size: 15px; color: #0284c7; font-weight: bold;">${t.labels.total}</td>
        <td style="padding: 12px 16px; font-family: Arial, sans-serif; font-size: 15px; color: #0284c7; font-weight: bold; text-align: ${endAlign};">${currency} ${total}</td>
      </tr>
    </table>

    <!-- Customer contact (PII: name + phone only, never email) -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 20px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      <tr>
        <td colspan="2" style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 13px; color: #111827; font-weight: bold; background-color: #f9fafb; border-bottom: 1px solid #f3f4f6;">
          ${t.labels.customerSection}
        </td>
      </tr>
      <tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">${t.labels.customerName}</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; border-bottom: 1px solid #f3f4f6; text-align: ${endAlign};">${customerName}</td>
      </tr>
      <tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280;">${t.labels.customerPhone}</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; text-align: ${endAlign}; font-variant-numeric: tabular-nums;">${customerPhone || '—'}</td>
      </tr>
    </table>

    ${ctaButton(t.viewButton, viewUrl)}

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 13px; color: #9ca3af; text-align: center; padding-top: 8px;">
          ${t.questions}
        </td>
      </tr>
    </table>`;

  const L = t.labels;
  const phoneLine = data.customerPhone || '—';
  const text = [
    t.greeting(data.vendorName),
    '',
    `${L.reference}: ${data.bookingRef}`,
    `${L.activity}: ${data.activityTitle}`,
    `${L.date}: ${data.date}`,
    ...(data.time ? [`${L.time}: ${data.time}`] : []),
    `${L.guests}: ${data.guests}`,
    `${L.total}: ${data.currency} ${data.totalAmount}`,
    ...(data.locationAddress ? [`${L.location}: ${data.locationAddress}`] : []),
    '',
    L.customerSection,
    `${L.customerName}: ${data.customerName}`,
    `${L.customerPhone}: ${phoneLine}`,
    '',
    `${t.viewButton}: ${viewUrl}`,
    '',
    t.questions,
  ].join('\n');

  return {
    subject: t.subject(data.bookingRef, data.guests),
    html: baseTemplate(content, { locale, previewText: t.preview(data.activityTitle) }),
    text,
  };
}
