import { baseTemplate, escapeHtml, ctaButton, type RenderedEmail } from './base';
import type { EmailLanguage } from '../../common/utils/locale';

export interface BookingConfirmationData {
  customerName: string;
  activityTitle: string;
  date: string;
  time?: string;
  guests: number;
  totalAmount: string;
  currency: string;
  bookingId: string;
  locationAddress?: string;
  mapsLink?: string;
}

const STRINGS: Record<
  EmailLanguage,
  {
    subject: string;
    heading: string;
    greeting: (name: string) => string;
    preview: (activity: string) => string;
    labels: { reference: string; activity: string; date: string; time: string; guests: string; total: string; location: string };
    mapsButton: string;
    viewButton: string;
    questions: string;
  }
> = {
  EN: {
    subject: 'Booking Confirmed — AL Jadwal',
    heading: 'Booking Confirmed &#10003;',
    greeting: (name) => `Hi ${name}, your booking has been confirmed! Here are your details:`,
    preview: (activity) => `Your booking for ${activity} is confirmed!`,
    labels: { reference: 'Reference', activity: 'Activity', date: 'Date', time: 'Time', guests: 'Guests', total: 'Total', location: 'Location' },
    mapsButton: 'Open in Google Maps',
    viewButton: 'View Booking',
    questions: 'If you have any questions, reply to this email and our team will help.',
  },
  AR: {
    subject: 'تأكيد الحجز — AL Jadwal',
    heading: 'تم تأكيد الحجز &#10003;',
    greeting: (name) => `مرحبًا ${name}، تم تأكيد حجزك! إليك التفاصيل:`,
    preview: (activity) => `تم تأكيد حجزك للنشاط ${activity}!`,
    labels: { reference: 'المرجع', activity: 'النشاط', date: 'التاريخ', time: 'الوقت', guests: 'الضيوف', total: 'الإجمالي', location: 'الموقع' },
    mapsButton: 'افتح في خرائط Google',
    viewButton: 'عرض الحجز',
    questions: 'إذا كان لديك أي استفسار، يمكنك الرد على هذا البريد وسيساعدك فريقنا.',
  },
};

export function bookingConfirmationTemplate(
  data: BookingConfirmationData,
  locale: EmailLanguage = 'EN',
): RenderedEmail {
  const t = STRINGS[locale];
  const endAlign = locale === 'AR' ? 'left' : 'right';

  const name = escapeHtml(data.customerName);
  const activity = escapeHtml(data.activityTitle);
  const date = escapeHtml(data.date);
  const time = data.time ? escapeHtml(data.time) : null;
  const guests = escapeHtml(String(data.guests));
  const total = escapeHtml(data.totalAmount);
  const currency = escapeHtml(data.currency);
  const bookingId = escapeHtml(data.bookingId);
  const address = data.locationAddress ? escapeHtml(data.locationAddress) : null;
  const mapsLink = data.mapsLink || null;
  const viewUrl = `{{APP_URL}}/bookings/${bookingId}`;

  const timeRow = time
    ? `<tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">${t.labels.time}</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; border-bottom: 1px solid #f3f4f6; text-align: ${endAlign};">${time}</td>
      </tr>`
    : '';

  const locationSection = address
    ? `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 20px;">
        <tr>
          <td style="font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; padding-bottom: 4px;">
            <strong style="color: #111827;">${t.labels.location}</strong>
          </td>
        </tr>
        <tr>
          <td style="font-family: Arial, sans-serif; font-size: 14px; color: #374151; padding-bottom: 8px;">
            ${address}
          </td>
        </tr>
        ${mapsLink ? `<tr><td>${ctaButton(t.mapsButton, mapsLink)}</td></tr>` : ''}
      </table>`
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
          ${t.greeting(name)}
        </td>
      </tr>
    </table>

    <!-- Booking details table -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      <tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">${t.labels.reference}</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; border-bottom: 1px solid #f3f4f6; text-align: ${endAlign}; font-variant-numeric: tabular-nums;">${bookingId}</td>
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
      <tr style="background-color: #f0f9ff;">
        <td style="padding: 12px 16px; font-family: Arial, sans-serif; font-size: 15px; color: #0284c7; font-weight: bold;">${t.labels.total}</td>
        <td style="padding: 12px 16px; font-family: Arial, sans-serif; font-size: 15px; color: #0284c7; font-weight: bold; text-align: ${endAlign};">${currency} ${total}</td>
      </tr>
    </table>

    ${locationSection}

    ${ctaButton(t.viewButton, viewUrl)}

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 13px; color: #9ca3af; text-align: center; padding-top: 8px;">
          ${t.questions}
        </td>
      </tr>
    </table>`;

  const L = t.labels;
  const text = [
    t.greeting(data.customerName),
    '',
    `${L.reference}: ${data.bookingId}`,
    `${L.activity}: ${data.activityTitle}`,
    `${L.date}: ${data.date}`,
    ...(data.time ? [`${L.time}: ${data.time}`] : []),
    `${L.guests}: ${data.guests}`,
    `${L.total}: ${data.currency} ${data.totalAmount}`,
    ...(data.locationAddress ? ['', `${L.location}: ${data.locationAddress}`] : []),
    ...(data.mapsLink ? [data.mapsLink] : []),
    '',
    `${t.viewButton}: ${viewUrl}`,
    '',
    t.questions,
  ].join('\n');

  return {
    subject: t.subject,
    html: baseTemplate(content, { locale, previewText: t.preview(data.activityTitle) }),
    text,
  };
}
