import { baseTemplate, escapeHtml, ctaButton } from './base';

export interface BookingCancellationData {
  customerName: string;
  activityTitle: string;
  date: string;
  bookingId: string;
  refundAmount?: string;
  currency?: string;
}

export function bookingCancellationTemplate(data: BookingCancellationData): string {
  const name = escapeHtml(data.customerName);
  const activity = escapeHtml(data.activityTitle);
  const date = escapeHtml(data.date);
  const bookingId = escapeHtml(data.bookingId);

  // Refund goes to Wanasa points (store credit), not back to card.
  // The vendor reviews the request and decides the amount. Once approved,
  // the refund is converted to Wanasa loyalty points automatically.
  const refundSection = `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 20px; border: 1px solid #fde68a; border-radius: 8px; overflow: hidden; background-color: #fffbeb;">
        <tr>
          <td style="padding: 16px; font-family: Arial, sans-serif;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
              <tr>
                <td style="font-size: 14px; color: #92400e; font-weight: bold; padding-bottom: 4px;">Refund goes to your Wanasa balance</td>
              </tr>
              <tr>
                <td style="font-size: 14px; color: #78350f;">
                  Your cancellation has been recorded. The vendor will review your request and decide the refund amount. Any approved refund will be <strong>added as Wanasa loyalty points</strong> to your balance &#x2014; you can use them to book activities on AL Jadwal.
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
          Booking Cancelled
        </td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 15px; color: #374151; padding-bottom: 24px; line-height: 22px;">
          Hi ${name}, your booking has been cancelled. We&#x27;re sorry to see you go.
        </td>
      </tr>
    </table>

    <!-- Booking details table -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      <tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Reference</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; border-bottom: 1px solid #f3f4f6; text-align: right;">${bookingId}</td>
      </tr>
      <tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Activity</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; border-bottom: 1px solid #f3f4f6; text-align: right;">${activity}</td>
      </tr>
      <tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280;">Date</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; text-align: right;">${date}</td>
      </tr>
    </table>

    ${refundSection}

    ${ctaButton('Browse Activities', '{{APP_URL}}/explore')}

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 13px; color: #9ca3af; text-align: center; padding-top: 8px;">
          Changed your mind? You can always book again on AL Jadwal.
        </td>
      </tr>
    </table>`;

  return baseTemplate(content, `Your booking for ${activity} has been cancelled.`);
}
