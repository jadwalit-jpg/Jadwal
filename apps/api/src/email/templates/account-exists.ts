import { baseTemplate, escapeHtml, type RenderedEmail } from './base';
import type { EmailLanguage } from '../../common/utils/locale';

export interface AccountExistsData {
  userName: string;
}

/**
 * Sent to the OWNER of an email address when someone attempts to register a new
 * account with it. The registration endpoint returns the SAME generic response
 * as a fresh signup (so it never confirms to the requester whether the address
 * is already registered — anti-enumeration), and this email is how a legitimate
 * owner who forgot they have an account is guided back in, instead of being
 * silently left with a "check your email" that never arrives.
 */
const STRINGS: Record<
  EmailLanguage,
  {
    subject: string;
    preview: string;
    heading: string;
    greeting: (name: string) => string;
    body: string;
    action: (loginLink: string, resetLink: string) => string;
    ignore: string;
  }
> = {
  EN: {
    subject: 'You already have an AL Jadwal account',
    preview: 'Someone tried to sign up with your email',
    heading: 'You already have an account',
    greeting: (name) => `Hi ${name},`,
    body: 'Someone just tried to create an AL Jadwal account using this email address — but you already have one. No new account was created.',
    action: (loginLink, resetLink) =>
      `If this was you, simply <a href="${loginLink}" style="color:#0f766e; text-decoration:underline;">log in</a>. Forgot your password? You can <a href="${resetLink}" style="color:#0f766e; text-decoration:underline;">reset it here</a>.`,
    ignore: "If this wasn't you, you can safely ignore this email — your account is unchanged and remains secure.",
  },
  AR: {
    subject: 'لديك حساب بالفعل على AL Jadwal',
    preview: 'حاول شخص ما التسجيل باستخدام بريدك الإلكتروني',
    heading: 'لديك حساب بالفعل',
    greeting: (name) => `مرحبًا ${name}،`,
    body: 'حاول شخص ما للتو إنشاء حساب على AL Jadwal باستخدام عنوان بريدك الإلكتروني — لكن لديك حساب بالفعل. لم يتم إنشاء أي حساب جديد.',
    action: (loginLink, resetLink) =>
      `إذا كنت أنت، فما عليك سوى <a href="${loginLink}" style="color:#0f766e; text-decoration:underline;">تسجيل الدخول</a>. نسيت كلمة المرور؟ يمكنك <a href="${resetLink}" style="color:#0f766e; text-decoration:underline;">إعادة تعيينها من هنا</a>.`,
    ignore: 'إذا لم تكن أنت، يمكنك تجاهل هذا البريد بأمان — حسابك دون تغيير ولا يزال آمنًا.',
  },
};

export function accountExistsTemplate(
  data: AccountExistsData,
  locale: EmailLanguage = 'EN',
): RenderedEmail {
  const t = STRINGS[locale];
  const name = escapeHtml(data.userName || (locale === 'AR' ? 'بك' : 'there'));
  const loginUrl = '{{APP_URL}}/login';
  const resetUrl = '{{APP_URL}}/forgot-password';

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
          ${t.body}
        </td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 15px; color: #374151; padding-bottom: 16px; line-height: 22px;">
          ${t.action(loginUrl, resetUrl)}
        </td>
      </tr>
    </table>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="background-color: #f0fdfa; border-radius: 8px; padding: 14px 16px; font-family: Arial, sans-serif; font-size: 13px; color: #115e59; line-height: 20px;">
          ${t.ignore}
        </td>
      </tr>
    </table>
  `;

  const text = [
    t.greeting(data.userName || (locale === 'AR' ? 'بك' : 'there')),
    '',
    t.body,
    '',
    `${locale === 'AR' ? 'تسجيل الدخول' : 'Log in'}: ${loginUrl}`,
    `${locale === 'AR' ? 'إعادة تعيين كلمة المرور' : 'Reset password'}: ${resetUrl}`,
    '',
    t.ignore,
  ].join('\n');

  return {
    subject: t.subject,
    html: baseTemplate(content, { locale, previewText: t.preview }),
    text,
  };
}
