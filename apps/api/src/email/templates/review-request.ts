import { baseTemplate, escapeHtml, ctaButton, type RenderedEmail } from './base';
import type { EmailLanguage } from '../../common/utils/locale';

/**
 * Review ask: "How was <activity>? Rate your experience." Sent the morning
 * after the activity ends and, as a reminder, three days later. The button
 * opens the review form for that booking (/review/<ref>, Arabic under /ar).
 */
export interface ReviewRequestData {
  customerName: string;
  activityTitle: string;
  activityTitleAr?: string;
  /** ISO datetime of the activity's end (wall-clock tagged UTC). */
  endDate: string;
  bookingRef: string;
  /** True for the second ask. */
  reminder?: boolean;
}

const STRINGS: Record<
  EmailLanguage,
  {
    subject: (activity: string) => string;
    reminderSubject: (activity: string) => string;
    heading: string;
    reminderHeading: string;
    greeting: (name: string) => string;
    body: (activity: string, date: string) => string;
    reminderBody: (activity: string) => string;
    button: string;
    helps: string;
    optOut: string;
    preview: (activity: string) => string;
    labels: { reference: string; activity: string; date: string };
  }
> = {
  EN: {
    subject: (a) => `How was ${a}? Rate your experience — AL Jadwal`,
    reminderSubject: (a) => `A quick rating for ${a}? — AL Jadwal`,
    heading: 'How was your experience?',
    reminderHeading: 'Still time for a quick rating',
    greeting: (name) => `Hi ${name},`,
    body: (a, d) => `You went on ${a} on ${d}. A quick star rating helps other customers choose and helps the organiser improve.`,
    reminderBody: (a) => `A few days ago we asked how ${a} went. If you have ten seconds, a star rating would mean a lot.`,
    button: 'Rate your experience',
    helps: 'It takes a few seconds: pick 1 to 5 stars and you are done.',
    optOut: 'Prefer not to be asked about this booking? Choose "Don’t ask again" on the rating page.',
    preview: (a) => `Rate ${a} in a few seconds.`,
    labels: { reference: 'Reference', activity: 'Activity', date: 'Date' },
  },
  AR: {
    subject: (a) => `كيف كانت تجربتك في ${a}؟ قيّمها — AL Jadwal`,
    reminderSubject: (a) => `تقييم سريع لـ ${a}؟ — AL Jadwal`,
    heading: 'كيف كانت تجربتك؟',
    reminderHeading: 'ما زال بإمكانك التقييم',
    greeting: (name) => `مرحبًا ${name}،`,
    body: (a, d) => `شاركت في ${a} بتاريخ ${d}. تقييمك بالنجوم يساعد العملاء الآخرين على الاختيار ويساعد المنظّم على التحسين.`,
    reminderBody: (a) => `قبل أيام سألناك عن ${a}. إن كان لديك عشر ثوانٍ، فتقييمك بالنجوم يعني لنا الكثير.`,
    button: 'قيّم تجربتك',
    helps: 'يستغرق الأمر ثوانٍ قليلة: اختر من نجمة إلى خمس نجوم وانتهى.',
    optOut: 'لا تريد أن نسألك عن هذا الحجز؟ اختر «لا تسألني مرة أخرى» في صفحة التقييم.',
    preview: (a) => `قيّم ${a} في ثوانٍ قليلة.`,
    labels: { reference: 'المرجع', activity: 'النشاط', date: 'التاريخ' },
  },
};

function formatEndDate(iso: string, locale: EmailLanguage): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === 'AR' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function reviewRequestTemplate(data: ReviewRequestData, locale: EmailLanguage = 'EN'): RenderedEmail {
  const t = STRINGS[locale];
  const endAlign = locale === 'AR' ? 'left' : 'right';
  const rawTitle = locale === 'AR' ? (data.activityTitleAr || data.activityTitle) : data.activityTitle;
  const name = escapeHtml(data.customerName);
  const activity = escapeHtml(rawTitle);
  const date = formatEndDate(data.endDate, locale);
  const ref = escapeHtml(data.bookingRef);
  const reviewUrl = `{{APP_URL}}${locale === 'AR' ? '/ar' : ''}/review/${encodeURIComponent(data.bookingRef)}`;
  const heading = data.reminder ? t.reminderHeading : t.heading;
  const body = data.reminder ? t.reminderBody(activity) : t.body(activity, escapeHtml(date));

  const content = `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 22px; font-weight: bold; color: #111827; padding-bottom: 8px;">
          ${heading}
        </td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 15px; color: #374151; padding-bottom: 8px; line-height: 22px;">
          ${t.greeting(name)}
        </td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 15px; color: #374151; padding-bottom: 24px; line-height: 22px;">
          ${body}
        </td>
      </tr>
    </table>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      <tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">${t.labels.activity}</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; border-bottom: 1px solid #f3f4f6; text-align: ${endAlign};">${activity}</td>
      </tr>
      <tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">${t.labels.date}</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; border-bottom: 1px solid #f3f4f6; text-align: ${endAlign};">${escapeHtml(date)}</td>
      </tr>
      <tr>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #6b7280;">${t.labels.reference}</td>
        <td style="padding: 10px 16px; font-family: Arial, sans-serif; font-size: 14px; color: #111827; font-weight: 600; text-align: ${endAlign};">${ref}</td>
      </tr>
    </table>

    ${ctaButton(t.button, reviewUrl)}

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 13px; color: #6b7280; text-align: center; padding-top: 8px;">
          ${t.helps}
        </td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 12px; color: #9ca3af; text-align: center; padding-top: 12px;">
          ${t.optOut}
        </td>
      </tr>
    </table>`;

  const text = [
    t.greeting(data.customerName),
    '',
    data.reminder ? t.reminderBody(rawTitle) : t.body(rawTitle, date),
    '',
    `${t.labels.activity}: ${rawTitle}`,
    `${t.labels.date}: ${date}`,
    `${t.labels.reference}: ${data.bookingRef}`,
    '',
    `${t.button}: ${reviewUrl}`,
    '',
    t.helps,
    t.optOut,
  ].join('\n');

  return {
    subject: data.reminder ? t.reminderSubject(rawTitle) : t.subject(rawTitle),
    html: baseTemplate(content, { locale, previewText: t.preview(rawTitle) }),
    text,
  };
}
