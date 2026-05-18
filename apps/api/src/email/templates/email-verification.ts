import { baseTemplate, escapeHtml, ctaButton, type RenderedEmail } from './base';
import type { EmailLanguage } from '../../common/utils/locale';

export interface EmailVerificationData {
  userName: string;
  verificationLink: string;
}

const STRINGS: Record<
  EmailLanguage,
  {
    subject: string;
    preview: string;
    heading: string;
    greeting: (name: string) => string;
    instruction: string;
    button: string;
    expires: (hours: string) => string;
    warning: string;
    fallback: string;
  }
> = {
  EN: {
    subject: 'Verify your email — AL Jadwal',
    preview: 'Verify your email to start using AL Jadwal',
    heading: 'Verify Your Email',
    greeting: (name) => `Hi ${name}, welcome to AL Jadwal!`,
    instruction: 'Please verify your email address to get started. Just click the button below.',
    button: 'Verify Email',
    expires: (hours) => `This link expires in ${hours} hours.`,
    warning: "Didn't create an account? You can safely ignore this email.",
    fallback: "If the button doesn't work, copy and paste this link into your browser:",
  },
  AR: {
    subject: 'تأكيد بريدك الإلكتروني — AL Jadwal',
    preview: 'أكّد بريدك الإلكتروني لبدء استخدام AL Jadwal',
    heading: 'تأكيد بريدك الإلكتروني',
    greeting: (name) => `مرحبًا ${name}، أهلًا بك في AL Jadwal!`,
    instruction: 'يرجى تأكيد عنوان بريدك الإلكتروني للبدء. ما عليك سوى الضغط على الزر أدناه.',
    button: 'تأكيد البريد الإلكتروني',
    expires: (hours) => `تنتهي صلاحية هذا الرابط خلال ${hours} ساعة.`,
    warning: 'لم تُنشئ حسابًا؟ يمكنك تجاهل هذا البريد بأمان.',
    fallback: 'إذا لم يعمل الزر، انسخ هذا الرابط والصقه في متصفحك:',
  },
};

export function emailVerificationTemplate(
  data: EmailVerificationData,
  locale: EmailLanguage = 'EN',
): RenderedEmail {
  const t = STRINGS[locale];
  const name = escapeHtml(data.userName);
  const expiryHours = '24';

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
        <td style="font-family: Arial, sans-serif; font-size: 15px; color: #374151; padding-bottom: 16px; line-height: 22px;">
          ${escapeHtml(t.instruction)}
        </td>
      </tr>
    </table>

    ${ctaButton(t.button, data.verificationLink)}

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 13px; color: #dc2626; text-align: center; padding-bottom: 16px;">
          ${t.expires(expiryHours)}
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
          <span style="color: #0284c7; word-break: break-all;">${escapeHtml(data.verificationLink)}</span>
        </td>
      </tr>
    </table>`;

  const text = [
    t.greeting(data.userName),
    '',
    t.instruction,
    '',
    `${t.button}: ${data.verificationLink}`,
    '',
    t.expires(expiryHours),
    t.warning,
  ].join('\n');

  return {
    subject: t.subject,
    html: baseTemplate(content, { locale, previewText: t.preview }),
    text,
  };
}
