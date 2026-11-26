/**
 * E2E — customer lands on /payment/callback after PAY2M redirects back.
 *
 * The page is purely client-rendered from URL params:
 *   ?status=success  → "Payment Successful"
 *   ?status=pending  → "Verifying Your Payment" (polls the booking)
 *   ?status=checking → "We're checking your payment": the API could not read
 *                      the gateway's return at all, so it points the customer
 *                      to My Bookings and WhatsApp instead of a false failure
 *   anything else    → "Payment Failed"
 * No API call is made for success/failed/checking — no need to mock anything.
 */
import { test, expect } from '@playwright/test';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';
test.describe('Customer payment callback', () => {
  test.use({ storageState: CUSTOMER_STATE });

  test('happy: ?status=success shows "Payment Successful"', async ({ page }) => {
    await page.goto('/payment/callback?status=success&bookingId=mock');
    await expect(
      page.getByRole('heading', { name: /payment successful|تم الدفع|نجح/i }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('error: ?status=failed shows "Payment Failed"', async ({ page }) => {
    await page.goto('/payment/callback?status=failed&error=CARD_DECLINED');
    await expect(
      page.getByRole('heading', { name: /payment failed|فشل|الدفع/i }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('neutral: ?status=checking points to My Bookings and WhatsApp, never "failed"', async ({ page }) => {
    await page.goto('/payment/callback?status=checking');
    const card = page.getByTestId('payment-checking');
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card.getByRole('heading', { name: /checking your payment/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /payment failed/i })).toHaveCount(0);
    await expect(card.getByRole('link', { name: /my bookings/i })).toHaveAttribute('href', '/bookings');
    const wa = page.getByTestId('payment-checking-whatsapp');
    await expect(wa).toHaveAttribute('href', /wa\.me\/|whatsapp\.com\//);
    await expect(wa).toHaveAttribute('target', '_blank');
  });

  test('neutral in Arabic: the checking page is translated', async ({ page, context }) => {
    // /payment/* is not URL-localised; the language comes from the cookie.
    await context.addCookies([{ name: 'jadwal_lang', value: 'ar', domain: 'localhost', path: '/' }]);
    await page.goto('/payment/callback?status=checking');
    const card = page.getByTestId('payment-checking');
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card.getByRole('heading', { name: /نتحقق من دفعتك/ })).toBeVisible();
    await expect(page.getByTestId('payment-checking-whatsapp')).toContainText('واتساب');
  });
});
