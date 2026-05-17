import { baseTemplate, escapeHtml } from './base';

export interface PasswordChangedData {
  customerName: string;
}

export function passwordChangedTemplate(data: PasswordChangedData): string {
  const name = escapeHtml(data.customerName || 'there');

  const content = `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 22px; font-weight: bold; color: #111827; padding-bottom: 8px;">
          Your password was changed
        </td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 15px; color: #374151; padding-bottom: 16px; line-height: 22px;">
          Hi ${name}, the password on your AL Jadwal account was just changed. All other sessions have been signed out for your security.
        </td>
      </tr>
    </table>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="background-color: #fef2f2; border-radius: 8px; padding: 14px 16px; font-family: Arial, sans-serif; font-size: 13px; color: #991b1b; line-height: 20px;">
          <strong>Didn&#x27;t make this change?</strong> Reset your password immediately at <a href="{{APP_URL}}/forgot-password" style="color: #991b1b; text-decoration: underline;">{{APP_URL}}/forgot-password</a> and contact support.
        </td>
      </tr>
    </table>
  `;

  return baseTemplate(content);
}
