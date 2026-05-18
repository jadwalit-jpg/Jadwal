import { baseTemplate, escapeHtml, ctaButton, type RenderedEmail } from './base';
import type { EmailLanguage } from '../../common/utils/locale';

export interface PasswordResetData {
  userName: string;
  resetLink: string;
  expiresIn: string;
}

const STRINGS: Record<
  EmailLanguage,
  {
    subject: string;
    preview: string;
    heading: string;
    greeting: (name: string) => string;
    button: string;
    expires: (duration: string) => string;
    warning: string;
    fallback: string;
  }
> = {
  EN: {
    subject: 'Reset Your Password — AL Jadwal',
    preview: 'Reset your AL Jadwal password',
    heading: 'Reset Your Password',
    greeting: (name) =>
      `Hi ${name}, we received a request to reset your password. Click the button below to choose a new one.`,
    button: 'Reset Password',
    expires: (duration) => `This link expires in ${duration}.`,
    warning:
      "Didn't request this? You can safely ignore this email. Your password will remain unchanged.",
    fallback: "If the button doesn't work, copy and paste this link into your browser:",
  },
  AR: {
    subject: 'إعادة تعيين كلمة المرور — AL Jadwal',
    preview: 'إعادة تعيين كلمة مرور AL Jadwal',
    heading: 'إعادة تعيين كلمة المرور',
    greeting: (name) =>
      `مرحبًا ${name}، تلقّينا طلبًا لإعادة تعيين كلمة مرورك. اضغط على الزر أدناه لاختيار كلمة مرور جديدة.`,
    button: 'إعادة تعيين كلمة المرور',
    expires: (duration) => `تنتهي صلاحية هذا الرابط خلال ${duration}.`,
    warning: 'لم تطلب ذلك؟ يمكنك تجاهل هذا البريد بأمان. ستبقى كلمة مرورك دون تغيير.',
    fallback: 'إذا لم يعمل الزر، انسخ هذا الرابط والصقه في متصفحك:',
  },
};

export function passwordResetTemplate(
  data: PasswordResetData,
  locale: EmailLanguage = 'EN',
): RenderedEmail {
  const t = STRINGS[locale];
  const name = escapeHtml(data.userName);
  const expiry = escapeHtml(data.expiresIn);

  const content = `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 22px; font-weight: bold; color: #111827; padding-bottom: 8px;">
          ${t.heading}
        </td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 15px; color: #374151; padding-bottom: 16px; line-height: 22px;">
          ${t.greeting(name)}
        </td>
      </tr>
    </table>

    ${ctaButton(t.button, data.resetLink)}

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 13px; color: #dc2626; text-align: center; padding-bottom: 16px;">
          ${t.expires(expiry)}
        </td>
      </tr>
      <tr>
        <td style="background-color: #fefce8; border-radius: 8px; padding: 14px 16px; font-family: Arial, sans-serif; font-size: 13px; color: #854d0e; line-height: 20px;">
          ${escapeHtml(t.warning)}
        </td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 12px; color: #9ca3af; padding-top: 16px; line-height: 18px; text-align: center;">
          ${escapeHtml(t.fallback)}<br>
          <span style="color: #0284c7; word-break: break-all;">${escapeHtml(data.resetLink)}</span>
        </td>
      </tr>
    </table>`;

  const text = [
    t.greeting(data.userName),
    '',
    `${t.button}: ${data.resetLink}`,
    '',
    t.expires(data.expiresIn),
    t.warning,
  ].join('\n');

  return {
    subject: t.subject,
    html: baseTemplate(content, { locale, previewText: t.preview }),
    text,
  };
}
