import { baseTemplate, escapeHtml, ctaButton } from './base';

export interface EmailVerificationData {
  userName: string;
  verificationLink: string;
}

export function emailVerificationTemplate(data: EmailVerificationData): string {
  const name = escapeHtml(data.userName);
  const expiryHours = '24';

  const content = `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 22px; font-weight: bold; color: #111827; padding-bottom: 8px;">
          Verify Your Email
        </td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 15px; color: #374151; padding-bottom: 8px; line-height: 22px;">
          Hi ${name}, welcome to AL Jadwal!
        </td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 15px; color: #374151; padding-bottom: 16px; line-height: 22px;">
          Please verify your email address to get started. Just click the button below.
        </td>
      </tr>
    </table>

    ${ctaButton('Verify Email', data.verificationLink)}

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 13px; color: #dc2626; text-align: center; padding-bottom: 16px;">
          This link expires in ${expiryHours} hours.
        </td>
      </tr>
      <tr>
        <td style="background-color: #fefce8; border-radius: 8px; padding: 14px 16px; font-family: Arial, sans-serif; font-size: 13px; color: #854d0e; line-height: 20px;">
          <strong>Didn&#x27;t create an account?</strong> You can safely ignore this email.
        </td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 12px; color: #9ca3af; padding-top: 16px; line-height: 18px; text-align: center;">
          If the button doesn&#x27;t work, copy and paste this link into your browser:<br>
          <span style="color: #0284c7; word-break: break-all;">${escapeHtml(data.verificationLink)}</span>
        </td>
      </tr>
    </table>`;

  return baseTemplate(content, 'Verify your email to start using AL Jadwal');
}
