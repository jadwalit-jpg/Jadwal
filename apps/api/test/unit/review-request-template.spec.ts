/**
 * The review-ask email: first ask and reminder, English and Arabic, with the
 * stable review link for the booking and no raw HTML from user data.
 */
import { reviewRequestTemplate } from '../../src/email/templates/review-request';

const data = {
  customerName: 'Sara <b>x</b>',
  activityTitle: 'Desert Safari & Camp',
  activityTitleAr: 'سفاري الصحراء',
  endDate: '2026-11-20T18:00:00.000Z',
  bookingRef: 'JDWL-E2ECMP',
};

describe('reviewRequestTemplate', () => {
  it('English first ask: subject, body, button link and the booking row', () => {
    const r = reviewRequestTemplate(data, 'EN');
    expect(r.subject).toBe('How was Desert Safari & Camp? Rate your experience — AL Jadwal');
    expect(r.html).toContain('How was your experience?');
    expect(r.html).toContain('{{APP_URL}}/review/JDWL-E2ECMP');
    expect(r.html).toContain('Rate your experience');
    expect(r.html).toContain('Desert Safari &amp; Camp');
    expect(r.html).toContain('20 November 2026');
    expect(r.html).not.toContain('<b>x</b>'); // user-supplied text is escaped
    expect(r.text).toContain('Rate your experience: {{APP_URL}}/review/JDWL-E2ECMP');
    expect(r.text).toContain('Reference: JDWL-E2ECMP');
    expect(r.html).toContain('lang="en"');
  });

  it('English reminder: reminder subject and wording', () => {
    const r = reviewRequestTemplate({ ...data, reminder: true }, 'EN');
    expect(r.subject).toBe('A quick rating for Desert Safari & Camp? — AL Jadwal');
    expect(r.html).toContain('Still time for a quick rating');
    expect(r.text).toContain('A few days ago we asked how Desert Safari & Camp went.');
  });

  it('Arabic: Arabic title, Arabic link under /ar, RTL document', () => {
    const r = reviewRequestTemplate(data, 'AR');
    expect(r.subject).toContain('سفاري الصحراء');
    expect(r.html).toContain('{{APP_URL}}/ar/review/JDWL-E2ECMP');
    expect(r.html).toContain('قيّم تجربتك');
    expect(r.html).toContain('dir="rtl"');
    expect(r.text).toContain('المرجع: JDWL-E2ECMP');
    const reminder = reviewRequestTemplate({ ...data, reminder: true }, 'AR');
    expect(reminder.subject).toContain('تقييم سريع');
  });

  it('falls back to the English title when the Arabic one is missing', () => {
    const r = reviewRequestTemplate({ ...data, activityTitleAr: undefined }, 'AR');
    expect(r.subject).toContain('Desert Safari & Camp');
  });
});
