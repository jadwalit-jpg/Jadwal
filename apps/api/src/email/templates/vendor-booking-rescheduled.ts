import { baseTemplate, escapeHtml, ctaButton, type RenderedEmail } from './base';
import type { EmailLanguage } from '../../common/utils/locale';

/**
 * Vendor email when AL Jadwal support moves one of their bookings. Same PII
 * contract as the vendor booking notification: the customer's name and the
 * booking phone, never the customer's email.
 */
export interface VendorBookingRescheduledData {
  vendorName: string;
  vendorSlug: string;
  bookingRef: string;
  bookingId: string;
  activityTitle: string;
  activityTitleAr?: string | null;
  customerName: string;
  customerPhone: string;
  guests: number;
  fromText: string;
  toText: string;
  fromTextAr?: string;
  toTextAr?: string;
}

const STRINGS: Record<
  EmailLanguage,
  {
    subject: (ref: string) => string;
    heading: string;
    greeting: (name: string) => string;
    preview: (ref: string) => string;
    labels: { reference: string; activity: string; customer: string; phone: string; guests: string; was: string; now: string };
    note: string;
    button: string;
  }
> = {
  EN: {
    subject: (ref) => `Booking ${ref} moved to new dates — AL Jadwal`,
    heading: 'Booking date changed',
    greeting: (name) => `Hi ${name}, AL Jadwal support has moved one of your bookings. Please update your schedule.`,
    preview: (ref) => `Booking ${ref} is now on new dates.`,
    labels: { reference: 'Reference', activity: 'Activity', customer: 'Customer', phone: 'Phone', guests: 'Guests', was: 'Was', now: 'Now' },
    note: 'The booking keeps its guests, add-ons and payment. Any price difference was settled with the customer by AL Jadwal; your payout for this booking is unchanged.',
    button: 'Open bookings',
  },
  AR: {
    subject: (ref) => `تم نقل الحجز ${ref} إلى تاريخ جديد — AL Jadwal`,
    heading: 'تم تغيير تاريخ حجز',
    greeting: (name) => `مرحبًا ${name}، نقل فريق دعم AL Jadwal أحد حجوزاتك إلى تاريخ جديد. يرجى تحديث جدولك.`,
    preview: (ref) => `أصبح الحجز ${ref} في تاريخ جديد.`,
    labels: { reference: 'المرجع', activity: 'النشاط', customer: 'العميل', phone: 'الهاتف', guests: 'الضيوف', was: 'كان', now: 'أصبح' },
    note: 'يحتفظ الحجز بعدد الضيوف والإضافات والدفع. أي فرق في السعر تمت تسويته مع العميل من قبل AL Jadwal؛ ولا تتغير مستحقاتك عن هذا الحجز.',
    button: 'فتح الحجوزات',
  },
};

function row(label: string, value: string, endAlign: string, last = false): string {
  const border = last ? '' : 'border-bottom: 1px solid #f3f4f6;';
  return `
      <tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; ${border}">${label}</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; ${border} text-align: ${endAlign};">${value}</td>
      </tr>`;
}

export function vendorBookingRescheduledTemplate(data: VendorBookingRescheduledData, locale: EmailLanguage = 'EN'): RenderedEmail {
  const t = STRINGS[locale];
  const endAlign = locale === 'AR' ? 'left' : 'right';
  const title = locale === 'AR' ? (data.activityTitleAr || data.activityTitle) : data.activityTitle;
  const fromText = locale === 'AR' ? (data.fromTextAr || data.fromText) : data.fromText;
  const toText = locale === 'AR' ? (data.toTextAr || data.toText) : data.toText;
  const link = `{{APP_URL}}/vendor/${encodeURIComponent(data.vendorSlug)}/bookings`;

  const content = `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 22px; font-weight: bold; color: #111827; padding-bottom: 8px;">${t.heading}</td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 15px; color: #374151; padding-bottom: 24px; line-height: 22px;">${t.greeting(escapeHtml(data.vendorName))}</td>
      </tr>
    </table>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      ${row(t.labels.reference, escapeHtml(data.bookingRef), endAlign)}
      ${row(t.labels.activity, escapeHtml(title), endAlign)}
      ${row(t.labels.customer, escapeHtml(data.customerName), endAlign)}
      ${row(t.labels.phone, escapeHtml(data.customerPhone), endAlign)}
      ${row(t.labels.guests, String(data.guests), endAlign)}
      ${row(t.labels.was, `<span style="color:#9ca3af; text-decoration: line-through;">${escapeHtml(fromText)}</span>`, endAlign)}
      ${row(t.labels.now, `<span style="color:#047857;">${escapeHtml(toText)}</span>`, endAlign, true)}
    </table>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 14px; color: #374151; padding-top: 20px; line-height: 21px;">${escapeHtml(t.note)}</td>
      </tr>
    </table>

    ${ctaButton(t.button, link)}`;

  const text = [
    t.greeting(data.vendorName),
    '',
    `${t.labels.reference}: ${data.bookingRef}`,
    `${t.labels.activity}: ${title}`,
    `${t.labels.customer}: ${data.customerName}`,
    `${t.labels.phone}: ${data.customerPhone}`,
    `${t.labels.guests}: ${data.guests}`,
    `${t.labels.was}: ${fromText}`,
    `${t.labels.now}: ${toText}`,
    '',
    t.note,
    '',
    `${t.button}: ${link}`,
  ].join('\n');

  return {
    subject: t.subject(data.bookingRef),
    html: baseTemplate(content, { locale, previewText: t.preview(data.bookingRef) }),
    text,
  };
}
