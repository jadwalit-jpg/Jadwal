import { baseTemplate, escapeHtml, type RenderedEmail } from './base';
import type { EmailLanguage } from '../../common/utils/locale';

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
 * The plaintext code appears in the body ONLY — never in the subject or the
 * preview text (that would leak it to inbox-snippet / lock-screen surfaces).
 * Interpolated through escapeHtml() as defence-in-depth even though it's
 * strictly /^[0-9]{6}$/ by construction.
 */
const STRINGS: Record<
  EmailLanguage,
  {
    subject: string;
    preview: string;
    heading: string;
    greeting: (name: string) => string;
    instruction: (ref: string) => string;
    expires: (mins: number) => string;
    warning: string;
  }
> = {
  EN: {
    subject: 'Your AL Jadwal booking verification code',
    preview: 'Your AL Jadwal booking verification code',
    heading: 'Your booking verification code',
    greeting: (name) => `Hi ${name},`,
    instruction: (ref) => `Use the code below to confirm booking ${ref} and proceed to payment.`,
    expires: (mins) => `This code expires in ${mins} minutes.`,
    warning:
      "Never share this code. AL Jadwal staff will never ask for it. If you didn't start a booking, you can safely ignore this email.",
  },
  AR: {
    subject: 'رمز التحقق لحجزك في AL Jadwal',
    preview: 'رمز التحقق لحجزك في AL Jadwal',
    heading: 'رمز التحقق لحجزك',
    greeting: (name) => `مرحبًا ${name}،`,
    instruction: (ref) => `استخدم الرمز أدناه لتأكيد الحجز ${ref} والمتابعة إلى الدفع.`,
    expires: (mins) => `تنتهي صلاحية هذا الرمز خلال ${mins} دقائق.`,
    warning:
      'لا تشارك هذا الرمز أبدًا. لن يطلبه منك موظفو AL Jadwal. إذا لم تبدأ عملية حجز، يمكنك تجاهل هذا البريد بأمان.',
  },
};

export function bookingOtpTemplate(
  data: BookingOtpData,
  locale: EmailLanguage = 'EN',
): RenderedEmail {
  const t = STRINGS[locale];
  const name = escapeHtml(data.customerName);
  const code = escapeHtml(data.otpCode);
  const ref = escapeHtml(data.bookingRef);
  const mins = data.expiresInMinutes;

  const content = `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 22px; font-weight: bold; color: #111827; padding-bottom: 8px;">
          ${t.heading}
        </td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 15px; color: #374151; padding-bottom: 8px; line-height: 22px;">
          ${t.greeting(name)}
        </td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 15px; color: #374151; padding-bottom: 20px; line-height: 22px;">
          ${t.instruction(`<strong>${ref}</strong>`)}
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
          ${t.expires(mins)}
        </td>
      </tr>
      <tr>
        <td style="background-color: #fefce8; border-radius: 8px; padding: 14px 16px; font-family: Arial, sans-serif; font-size: 13px; color: #854d0e; line-height: 20px;">
          ${escapeHtml(t.warning)}
        </td>
      </tr>
    </table>`;

  const text = [
    t.greeting(data.customerName),
    '',
    t.instruction(data.bookingRef),
    '',
    data.otpCode,
    '',
    t.expires(mins),
    '',
    t.warning,
  ].join('\n');

  return {
    subject: t.subject,
    html: baseTemplate(content, { locale, previewText: t.preview }),
    text,
  };
}
