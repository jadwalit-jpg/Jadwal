import { baseTemplate, escapeHtml, type RenderedEmail } from './base';
import type { EmailLanguage } from '../../common/utils/locale';

export interface PasswordChangedData {
  customerName: string;
}

const STRINGS: Record<
  EmailLanguage,
  {
    subject: string;
    preview: string;
    heading: string;
    greeting: (name: string) => string;
    warning: (link: string) => string;
  }
> = {
  EN: {
    subject: 'Your password was changed — AL Jadwal',
    preview: 'Your AL Jadwal password was changed',
    heading: 'Your password was changed',
    greeting: (name) =>
      `Hi ${name}, the password on your AL Jadwal account was just changed. All other sessions have been signed out for your security.`,
    warning: (link) =>
      `Didn't make this change? Reset your password immediately at ${link} and contact support.`,
  },
  AR: {
    subject: 'تم تغيير كلمة المرور — AL Jadwal',
    preview: 'تم تغيير كلمة مرور AL Jadwal',
    heading: 'تم تغيير كلمة المرور',
    greeting: (name) =>
      `مرحبًا ${name}، تم تغيير كلمة المرور الخاصة بحسابك على AL Jadwal للتوّ. تم تسجيل الخروج من جميع الجلسات الأخرى من أجل أمانك.`,
    warning: (link) =>
      `لم تقم بهذا التغيير؟ أعد تعيين كلمة مرورك فورًا عبر ${link} وتواصل مع الدعم.`,
  },
};

export function passwordChangedTemplate(
  data: PasswordChangedData,
  locale: EmailLanguage = 'EN',
): RenderedEmail {
  const t = STRINGS[locale];
  const name = escapeHtml(data.customerName || (locale === 'AR' ? 'بك' : 'there'));
  const resetUrl = '{{APP_URL}}/forgot-password';

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

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="background-color: #fef2f2; border-radius: 8px; padding: 14px 16px; font-family: Arial, sans-serif; font-size: 13px; color: #991b1b; line-height: 20px;">
          ${t.warning(`<a href="${resetUrl}" style="color: #991b1b; text-decoration: underline;">${resetUrl}</a>`)}
        </td>
      </tr>
    </table>
  `;

  const text = [
    t.greeting(data.customerName || (locale === 'AR' ? 'بك' : 'there')),
    '',
    t.warning(resetUrl),
  ].join('\n');

  return {
    subject: t.subject,
    html: baseTemplate(content, { locale, previewText: t.preview }),
    text,
  };
}
