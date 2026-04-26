/**
 * E2E — customer lands on /payment/callback after PAY2M redirects back.
 *
 * The page is purely client-rendered from URL params:
 *   ?status=success → "Payment Successful"
 *   anything else   → "Payment Failed"
 * No API call is made — no need to mock anything.
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

  test('error: anything other than ?status=success shows "Payment Failed"', async ({ page }) => {
    await page.goto('/payment/callback?status=failed&error=CARD_DECLINED');
    await expect(
      page.getByRole('heading', { name: /payment failed|فشل|الدفع/i }),
    ).toBeVisible({ timeout: 10000 });
  });
});
