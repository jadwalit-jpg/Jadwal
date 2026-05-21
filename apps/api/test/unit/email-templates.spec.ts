/**
 * Bilingual email template render tests (Phase 4B).
 *
 * Each customer template must render in both English (LTR) and Arabic (RTL),
 * return a localized subject, and produce a non-empty plain-text part that
 * carries no HTML tags. admin-alert is English-only.
 */
import { bookingConfirmationTemplate } from '../../src/email/templates/booking-confirmation';
import { bookingCancellationTemplate } from '../../src/email/templates/booking-cancellation';
import { bookingOtpTemplate } from '../../src/email/templates/booking-otp';
import { emailVerificationTemplate } from '../../src/email/templates/email-verification';
import { passwordResetTemplate } from '../../src/email/templates/password-reset';
import { passwordChangedTemplate } from '../../src/email/templates/password-changed';
import { adminAlertTemplate } from '../../src/email/templates/admin-alert';
import { vendorBookingNotificationTemplate } from '../../src/email/templates/vendor-booking-notification';
import type { RenderedEmail } from '../../src/email/templates/base';

/** Every customer template + representative data, exercised for EN + AR. */
const CUSTOMER_TEMPLATES: Array<{ name: string; render: (locale: 'EN' | 'AR') => RenderedEmail }> = [
  {
    name: 'booking-confirmation',
    render: (l) =>
      bookingConfirmationTemplate(
        { customerName: 'Sara', activityTitle: 'Desert Safari', date: '2030-01-01', guests: 2, totalAmount: '200', currency: 'QAR', bookingId: 'JDWL-1' },
        l,
      ),
  },
  {
    name: 'booking-cancellation',
    render: (l) =>
      bookingCancellationTemplate(
        { customerName: 'Sara', activityTitle: 'Desert Safari', date: '2030-01-01', bookingId: 'JDWL-1' },
        l,
      ),
  },
  {
    name: 'booking-otp',
    render: (l) =>
      bookingOtpTemplate({ customerName: 'Sara', otpCode: '123456', bookingRef: 'JDWL-1', expiresInMinutes: 10 }, l),
  },
  {
    name: 'email-verification',
    render: (l) => emailVerificationTemplate({ userName: 'Sara', verificationLink: 'https://x/v?t=abc' }, l),
  },
  {
    name: 'password-reset',
    render: (l) => passwordResetTemplate({ userName: 'Sara', resetLink: 'https://x/r?t=abc', expiresInHours: 1 }, l),
  },
  {
    name: 'password-changed',
    render: (l) => passwordChangedTemplate({ customerName: 'Sara' }, l),
  },
  {
    name: 'vendor-booking-notification',
    render: (l) =>
      vendorBookingNotificationTemplate(
        {
          vendorName: 'Acme Vendor',
          bookingRef: 'JDWL-V1',
          bookingId: 'booking-id-1',
          vendorSlug: 'acme-vendor',
          activityTitle: 'Desert Safari',
          date: '2030-01-01',
          guests: 2,
          totalAmount: '200',
          currency: 'QAR',
          customerName: 'Sara',
          customerPhone: '+97433333333',
        },
        l,
      ),
  },
];

describe('bilingual email templates', () => {
  describe.each(CUSTOMER_TEMPLATES)('$name', ({ render }) => {
    test('EN → LTR, English subject, plain-text part', () => {
      const out = render('EN');
      expect(out.subject.length).toBeGreaterThan(0);
      expect(out.html).toContain('lang="en"');
      expect(out.html).toContain('dir="ltr"');
      expect(out.text.length).toBeGreaterThan(0);
      expect(out.text).not.toMatch(/<[a-z]/i); // no HTML tags in the text part
    });

    test('AR → RTL, Arabic subject, plain-text part', () => {
      const out = render('AR');
      expect(out.html).toContain('lang="ar"');
      expect(out.html).toContain('dir="rtl"');
      // Subject contains Arabic-script characters.
      expect(out.subject).toMatch(/[؀-ۿ]/);
      expect(out.html).toMatch(/[؀-ۿ]/);
      expect(out.text.length).toBeGreaterThan(0);
      expect(out.text).not.toMatch(/<[a-z]/i);
    });

    test('EN and AR subjects differ', () => {
      expect(render('EN').subject).not.toBe(render('AR').subject);
    });
  });

  describe('admin-alert', () => {
    test('renders English-only with {subject, html, text}', () => {
      const out = adminAlertTemplate({ type: 'DATABASE_ERROR', generatedAt: '2030-01-01T00:00:00Z' });
      expect(out.subject).toBe('AL Jadwal alert:Database error');
      expect(out.html).toContain('lang="en"');
      expect(out.text).toContain('Database error');
      expect(out.text).not.toMatch(/<[a-z]/i);
    });
  });

  test('booking-otp keeps the code OUT of the subject (no leak)', () => {
    const out = bookingOtpTemplate(
      { customerName: 'Sara', otpCode: '987654', bookingRef: 'JDWL-9', expiresInMinutes: 10 },
      'EN',
    );
    expect(out.subject).not.toContain('987654');
    // …but the body and text part DO carry it.
    expect(out.html).toContain('987654');
    expect(out.text).toContain('987654');
  });

  describe('vendor-booking-notification (PII discipline + safety)', () => {
    const base = {
      vendorName: 'Acme Vendor',
      bookingRef: 'JDWL-V42',
      bookingId: 'booking-id-42',
      vendorSlug: 'acme-vendor',
      activityTitle: 'Desert Safari',
      date: '2030-01-01',
      guests: 3,
      totalAmount: '500',
      currency: 'QAR',
      customerName: 'Sara Customer',
      customerPhone: '+97433333333',
    };

    test('renders customer name + phone but NEVER the customer email', () => {
      const out = vendorBookingNotificationTemplate(base, 'EN');
      expect(out.html).toContain('Sara Customer');
      expect(out.html).toContain('+97433333333');
      expect(out.text).toContain('Sara Customer');
      expect(out.text).toContain('+97433333333');
      // The template signature does not accept a customer email at all, but
      // belt-and-braces: assert no @-sign in the customer section of the body.
      expect(out.html).not.toMatch(/customer[^@]*@[A-Za-z0-9.-]+/i);
    });

    test('escapes HTML in customerName and customerPhone (XSS defense)', () => {
      const out = vendorBookingNotificationTemplate(
        { ...base, customerName: '<script>alert(1)</script>', customerPhone: '"><img src=x>' },
        'EN',
      );
      expect(out.html).not.toContain('<script>');
      expect(out.html).toContain('&lt;script&gt;');
      expect(out.html).not.toContain('<img src=x>');
    });

    test('optional fields (time, locationAddress) gracefully omitted', () => {
      const out = vendorBookingNotificationTemplate(base, 'EN');
      // No "Time" row was injected — the label text shouldn't appear.
      expect(out.html).not.toMatch(/>Time</);
      expect(out.html).not.toMatch(/>Location</);
      // …but when supplied, both appear.
      const withOpts = vendorBookingNotificationTemplate(
        { ...base, time: '14:30', locationAddress: 'Doha, Qatar' },
        'EN',
      );
      expect(withOpts.html).toContain('14:30');
      expect(withOpts.html).toContain('Doha, Qatar');
    });

    test('dashboard CTA uses {{APP_URL}} placeholder + the vendor slug', () => {
      const out = vendorBookingNotificationTemplate(base, 'EN');
      expect(out.html).toContain('{{APP_URL}}/vendor/acme-vendor/bookings/booking-id-42');
      expect(out.text).toContain('{{APP_URL}}/vendor/acme-vendor/bookings/booking-id-42');
    });
  });
});
