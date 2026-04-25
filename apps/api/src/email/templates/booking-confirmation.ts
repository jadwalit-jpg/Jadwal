import { baseTemplate, escapeHtml, ctaButton } from './base';

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

export function bookingConfirmationTemplate(data: BookingConfirmationData): string {
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

  const timeRow = time
    ? `<tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Time</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; border-bottom: 1px solid #f3f4f6; text-align: right;">${time}</td>
      </tr>`
    : '';

  const locationSection = address
    ? `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 20px;">
        <tr>
          <td style="font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; padding-bottom: 4px;">
            <strong style="color: #111827;">Location</strong>
          </td>
        </tr>
        <tr>
          <td style="font-family: Arial, sans-serif; font-size: 14px; color: #374151; padding-bottom: 8px;">
            ${address}
          </td>
        </tr>
        ${mapsLink ? `<tr><td>${ctaButton('Open in Google Maps', mapsLink)}</td></tr>` : ''}
      </table>`
    : '';

  const content = `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 22px; font-weight: bold; color: #111827; padding-bottom: 8px;">
          Booking Confirmed &#10003;
        </td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 15px; color: #374151; padding-bottom: 24px; line-height: 22px;">
          Hi ${name}, your booking has been confirmed! Here are your details:
        </td>
      </tr>
    </table>

    <!-- Booking details table -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      <tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Reference</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; border-bottom: 1px solid #f3f4f6; text-align: right; font-variant-numeric: tabular-nums;">${bookingId}</td>
      </tr>
      <tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Activity</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; border-bottom: 1px solid #f3f4f6; text-align: right;">${activity}</td>
      </tr>
      <tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Date</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; border-bottom: 1px solid #f3f4f6; text-align: right;">${date}</td>
      </tr>
      ${timeRow}
      <tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Guests</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; border-bottom: 1px solid #f3f4f6; text-align: right;">${guests}</td>
      </tr>
      <tr style="background-color: #f0f9ff;">
        <td style="padding: 12px 16px; font-family: Arial, sans-serif; font-size: 15px; color: #0284c7; font-weight: bold;">Total</td>
        <td style="padding: 12px 16px; font-family: Arial, sans-serif; font-size: 15px; color: #0284c7; font-weight: bold; text-align: right;">${currency} ${total}</td>
      </tr>
    </table>

    ${locationSection}

    ${ctaButton('View Booking', `{{APP_URL}}/bookings/${bookingId}`)}

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 13px; color: #9ca3af; text-align: center; padding-top: 8px;">
          If you have any questions, reply to this email and our team will help.
        </td>
      </tr>
    </table>`;

  return baseTemplate(content, `Your booking for ${activity} is confirmed!`);
}
