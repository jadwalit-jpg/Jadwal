/**
 * E2E — the customer's booking page while a debit-card payment is being
 * confirmed with the bank.
 *
 * The seed has booking JDWL-E2EGWBN: PENDING, with a PAY2M payment whose
 * success callback failed verification (what the Nov 2026 incidents looked
 * like). The page must say the payment was received and is being confirmed,
 * offer WhatsApp with the reference prefilled, and hide Pay and Cancel so the
 * customer cannot pay twice. Runs on chromium and the mobile projects.
 */
import { test, expect } from '@playwright/test';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';
const REF = 'JDWL-E2EGWBN';

test.describe('Customer booking — payment being confirmed with the bank', () => {
  test.use({ storageState: CUSTOMER_STATE });

  test('happy: banner with WhatsApp link, no Pay / Cancel buttons (EN and AR)', async ({ page, context }) => {
    await page.goto('/bookings', { waitUntil: 'domcontentloaded' });
    const booking = await page.evaluate(async (ref) => {
      const r = await fetch(`/api/bookings/my?limit=50`, { credentials: 'include' });
      const data = await r.json();
      return (data?.data ?? []).find((b: { ref: string }) => b.ref === ref) ?? null;
    }, REF);
    test.skip(!booking, 'the seeded gateway booking is missing');

    await page.goto(`/bookings/${booking.id}`, { waitUntil: 'domcontentloaded' });
    const banner = page.getByTestId('bank-confirming-banner');
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText('Payment received');
    await expect(banner).toContainText('do not pay again');
    const wa = page.getByTestId('bank-confirming-whatsapp');
    await expect(wa).toHaveAttribute('href', /wa\.me\/97477499399/);
    expect(decodeURIComponent((await wa.getAttribute('href')) ?? '')).toContain(REF);
    const box = await wa.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await expect(page.getByRole('button', { name: /pay now|proceed to payment|ادفع|الدفع/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^cancel$|^cancel reservation$|إلغاء/i })).toHaveCount(0);
    await expect(page.getByText(/awaiting payment/i)).toHaveCount(0);

    // /bookings is an account page (not URL-localised): Arabic comes from the
    // language cookie, as the language switcher sets it.
    const base = new URL(page.url());
    await context.addCookies([{ name: 'jadwal_lang', value: 'ar', domain: base.hostname, path: '/' }]);
    await page.goto(`/bookings/${booking.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('bank-confirming-banner')).toContainText('تم استلام الدفع', { timeout: 30_000 });
    await expect(page.getByTestId('bank-confirming-whatsapp')).toContainText('واتساب');
  });
});
