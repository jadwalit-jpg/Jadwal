import { baseTemplate, escapeHtml } from './base';

export interface BookingOtpData {
  customerName: string;
  otpCode: string;          // 6-digit string — interpolated INTO the body
  bookingRef: string;
  expiresInMinutes: number;
}

/**
 * Booking email-OTP template.
 *
 * Sent when a customer creates a booking; they must enter the code on the
 * booking-detail page before /payment/initiate will issue a PAY2M token.
 *
 * Body is intentionally minimal — large monospace code block so customers
 * can read + type it on mobile without zoom. Single explicit "do not share"
 * disclaimer to discourage social-engineering forwarding.
 *
 * Plaintext code is interpolated through escapeHtml() as defense-in-depth
 * even though it's strictly /^[0-9]{6}$/ by construction.
 */
export function bookingOtpTemplate(data: BookingOtpData): string {
  const name = escapeHtml(data.customerName);
  const code = escapeHtml(data.otpCode);
  const ref = escapeHtml(data.bookingRef);
  const mins = data.expiresInMinutes;

  const content = `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 22px; font-weight: bold; color: #111827; padding-bottom: 8px;">
          Your booking verification code
        </td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 15px; color: #374151; padding-bottom: 8px; line-height: 22px;">
          Hi ${name},
        </td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 15px; color: #374151; padding-bottom: 20px; line-height: 22px;">
          Use the code below to confirm booking <strong>${ref}</strong> and proceed to payment.
        </td>
      </tr>
    </table>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 20px;">
      <tr>
        <td style="background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 20px; text-align: center; font-family: 'Courier New', Consolas, monospace; font-size: 32px; font-weight: bold; color: #0284c7; letter-spacing: 6px;">
          ${code}
        </td>
      </tr>
    </table>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 13px; color: #dc2626; text-align: center; padding-bottom: 16px;">
          This code expires in ${mins} minutes.
        </td>
      </tr>
      <tr>
        <td style="background-color: #fefce8; border-radius: 8px; padding: 14px 16px; font-family: Arial, sans-serif; font-size: 13px; color: #854d0e; line-height: 20px;">
          <strong>Never share this code.</strong> AL Jadwal staff will never ask for it. If you didn&#x27;t start a booking, you can safely ignore this email.
        </td>
      </tr>
    </table>`;

  // Preheader (inbox-preview / lock-screen snippet) must NOT carry the OTP —
  // that would leak the code without the email being opened. Code stays in
  // the body only.
  return baseTemplate(content, 'Your AL Jadwal booking verification code');
}
