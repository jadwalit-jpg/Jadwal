import { baseTemplate, escapeHtml, ctaButton, type RenderedEmail } from './base';
import type { EmailLanguage } from '../../common/utils/locale';

/**
 * Customer email when AL Jadwal support moves their booking to other dates.
 * The old and new windows arrive pre-formatted in both languages (see
 * booking-reschedule.text.ts) so the email matches the in-app notification
 * word for word. Money is settled outside the website and is not mentioned.
 */
export interface BookingRescheduledData {
  customerName: string;
  bookingRef: string;
  bookingId: string;
  activityTitle: string;
  activityTitleAr?: string | null;
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
    preview: (activity: string) => string;
    labels: { reference: string; activity: string; was: string; now: string };
    note: string;
    button: string;
    footer: string;
  }
> = {
  EN: {
    subject: (ref) => `Your booking ${ref} has new dates — AL Jadwal`,
    heading: 'Your booking date was changed',
    greeting: (name) => `Hi ${name}, AL Jadwal support has moved your booking to new dates. Here is the change.`,
    preview: (activity) => `Your booking for ${activity} is now on new dates.`,
    labels: { reference: 'Reference', activity: 'Activity', was: 'Was', now: 'Now' },
    note: 'Everything else about your booking stays the same: guests, add-ons and what you paid. If this change is not what you agreed, reply to this email or contact support.',
    button: 'View booking',
    footer: 'Thank you for booking with AL Jadwal.',
  },
  AR: {
    subject: (ref) => `تم تغيير تاريخ حجزك ${ref} — AL Jadwal`,
    heading: 'تم تغيير تاريخ حجزك',
    greeting: (name) => `مرحبًا ${name}، نقل فريق دعم AL Jadwal حجزك إلى تاريخ جديد. إليك التفاصيل.`,
    preview: (activity) => `أصبح حجزك للنشاط ${activity} في تاريخ جديد.`,
    labels: { reference: 'المرجع', activity: 'النشاط', was: 'كان', now: 'أصبح' },
    note: 'كل ما يتعلق بحجزك يبقى كما هو: عدد الضيوف والإضافات وما دفعته. إن لم يكن هذا التغيير ما اتفقت عليه، يرجى الرد على هذه الرسالة أو التواصل مع الدعم.',
    button: 'عرض الحجز',
    footer: 'شكرًا لحجزك مع AL Jadwal.',
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

export function bookingRescheduledTemplate(data: BookingRescheduledData, locale: EmailLanguage = 'EN'): RenderedEmail {
  const t = STRINGS[locale];
  const endAlign = locale === 'AR' ? 'left' : 'right';
  const title = locale === 'AR' ? (data.activityTitleAr || data.activityTitle) : data.activityTitle;
  const fromText = locale === 'AR' ? (data.fromTextAr || data.fromText) : data.fromText;
  const toText = locale === 'AR' ? (data.toTextAr || data.toText) : data.toText;
  const link = `{{APP_URL}}${locale === 'AR' ? '/ar' : ''}/bookings/${encodeURIComponent(data.bookingId)}`;

  const content = `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 22px; font-weight: bold; color: #111827; padding-bottom: 8px;">${t.heading}</td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 15px; color: #374151; padding-bottom: 24px; line-height: 22px;">${t.greeting(escapeHtml(data.customerName))}</td>
      </tr>
    </table>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      ${row(t.labels.reference, escapeHtml(data.bookingRef), endAlign)}
      ${row(t.labels.activity, escapeHtml(title), endAlign)}
      ${row(t.labels.was, `<span style="color:#9ca3af; text-decoration: line-through;">${escapeHtml(fromText)}</span>`, endAlign)}
      ${row(t.labels.now, `<span style="color:#047857;">${escapeHtml(toText)}</span>`, endAlign, true)}
    </table>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 14px; color: #374151; padding-top: 20px; line-height: 21px;">${escapeHtml(t.note)}</td>
      </tr>
    </table>

    ${ctaButton(t.button, link)}

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 13px; color: #9ca3af; text-align: center; padding-top: 8px;">${t.footer}</td>
      </tr>
    </table>`;

  const text = [
    t.greeting(data.customerName),
    '',
    `${t.labels.reference}: ${data.bookingRef}`,
    `${t.labels.activity}: ${title}`,
    `${t.labels.was}: ${fromText}`,
    `${t.labels.now}: ${toText}`,
    '',
    t.note,
    '',
    `${t.button}: ${link}`,
  ].join('\n');

  return {
    subject: t.subject(data.bookingRef),
    html: baseTemplate(content, { locale, previewText: t.preview(title) }),
    text,
  };
}
