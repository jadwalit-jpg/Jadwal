import { baseTemplate, escapeHtml, ctaButton } from './base';

export interface PasswordResetData {
  userName: string;
  resetLink: string;
  expiresIn: string;
}

export function passwordResetTemplate(data: PasswordResetData): string {
  const name = escapeHtml(data.userName);
  const expiryHours = escapeHtml(data.expiresIn);

  const content = `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 22px; font-weight: bold; color: #111827; padding-bottom: 8px;">
          Reset Your Password
        </td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 15px; color: #374151; padding-bottom: 16px; line-height: 22px;">
          Hi ${name}, we received a request to reset your password. Click the button below to choose a new one.
        </td>
      </tr>
    </table>

    ${ctaButton('Reset Password', data.resetLink)}

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 13px; color: #dc2626; text-align: center; padding-bottom: 16px;">
          This link expires in ${expiryHours}.
        </td>
      </tr>
      <tr>
        <td style="background-color: #fefce8; border-radius: 8px; padding: 14px 16px; font-family: Arial, sans-serif; font-size: 13px; color: #854d0e; line-height: 20px;">
          <strong>Didn&#x27;t request this?</strong> You can safely ignore this email. Your password will remain unchanged.
        </td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 12px; color: #9ca3af; padding-top: 16px; line-height: 18px; text-align: center;">
          If the button doesn&#x27;t work, copy and paste this link into your browser:<br>
          <span style="color: #0284c7; word-break: break-all;">${escapeHtml(data.resetLink)}</span>
        </td>
      </tr>
    </table>`;

  return baseTemplate(content, 'Reset your AL Jadwal password');
}
