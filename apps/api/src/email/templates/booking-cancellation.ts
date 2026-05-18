import { baseTemplate, escapeHtml, ctaButton, type RenderedEmail } from './base';
import type { EmailLanguage } from '../../common/utils/locale';

export interface BookingCancellationData {
  customerName: string;
  activityTitle: string;
  date: string;
  bookingId: string;
  refundAmount?: string;
  currency?: string;
}

const STRINGS: Record<
  EmailLanguage,
  {
    subject: string;
    heading: string;
    greeting: (name: string) => string;
    preview: (activity: string) => string;
    labels: { reference: string; activity: string; date: string };
    refundTitle: string;
    refundBody: string;
    browseButton: string;
    comeBack: string;
  }
> = {
  EN: {
    subject: 'Booking Cancelled — AL Jadwal',
    heading: 'Booking Cancelled',
    greeting: (name) => `Hi ${name}, your booking has been cancelled. We're sorry to see you go.`,
    preview: (activity) => `Your booking for ${activity} has been cancelled.`,
    labels: { reference: 'Reference', activity: 'Activity', date: 'Date' },
    refundTitle: 'Refund goes to your Wanasa balance',
    refundBody:
      'Your cancellation has been recorded. The vendor will review your request and decide the refund amount. Any approved refund will be added as Wanasa loyalty points to your balance — you can use them to book activities on AL Jadwal.',
    browseButton: 'Browse Activities',
    comeBack: 'Changed your mind? You can always book again on AL Jadwal.',
  },
  AR: {
    subject: 'إلغاء الحجز — AL Jadwal',
    heading: 'تم إلغاء الحجز',
    greeting: (name) => `مرحبًا ${name}، تم إلغاء حجزك. نأسف لمغادرتك.`,
    preview: (activity) => `تم إلغاء حجزك للنشاط ${activity}.`,
    labels: { reference: 'المرجع', activity: 'النشاط', date: 'التاريخ' },
    refundTitle: 'يُضاف المبلغ المسترد إلى رصيد وناسة',
    refundBody:
      'تم تسجيل طلب الإلغاء. سيراجع مزوّد الخدمة طلبك ويحدّد قيمة المبلغ المسترد. أي مبلغ تتم الموافقة عليه سيُضاف كنقاط ولاء وناسة إلى رصيدك — يمكنك استخدامها لحجز الأنشطة على AL Jadwal.',
    browseButton: 'تصفّح الأنشطة',
    comeBack: 'غيّرت رأيك؟ يمكنك دائمًا الحجز مرة أخرى على AL Jadwal.',
  },
};

export function bookingCancellationTemplate(
  data: BookingCancellationData,
  locale: EmailLanguage = 'EN',
): RenderedEmail {
  const t = STRINGS[locale];
  const endAlign = locale === 'AR' ? 'left' : 'right';

  const name = escapeHtml(data.customerName);
  const activity = escapeHtml(data.activityTitle);
  const date = escapeHtml(data.date);
  const bookingId = escapeHtml(data.bookingId);

  // Refund goes to Wanasa points (store credit), not back to card.
  const refundSection = `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 20px; border: 1px solid #fde68a; border-radius: 8px; overflow: hidden; background-color: #fffbeb;">
        <tr>
          <td style="padding: 16px; font-family: Arial, sans-serif;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
              <tr>
                <td style="font-size: 14px; color: #92400e; font-weight: bold; padding-bottom: 4px;">${t.refundTitle}</td>
              </tr>
              <tr>
                <td style="font-size: 14px; color: #78350f;">
                  ${escapeHtml(t.refundBody)}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`;

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
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; border-bottom: 1px solid #f3f4f6; text-align: ${endAlign};">${bookingId}</td>
      </tr>
      <tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">${t.labels.activity}</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; border-bottom: 1px solid #f3f4f6; text-align: ${endAlign};">${activity}</td>
      </tr>
      <tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280;">${t.labels.date}</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; text-align: ${endAlign};">${date}</td>
      </tr>
    </table>

    ${refundSection}

    ${ctaButton(t.browseButton, '{{APP_URL}}/explore')}

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 13px; color: #9ca3af; text-align: center; padding-top: 8px;">
          ${t.comeBack}
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
    '',
    `${t.refundTitle} — ${t.refundBody}`,
    '',
    `${t.browseButton}: {{APP_URL}}/explore`,
    '',
    t.comeBack,
  ].join('\n');

  return {
    subject: t.subject,
    html: baseTemplate(content, { locale, previewText: t.preview(data.activityTitle) }),
    text,
  };
}
