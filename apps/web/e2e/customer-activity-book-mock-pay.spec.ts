import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';
const HAS_CUSTOMER_STATE = existsSync(CUSTOMER_STATE);

test.describe('Customer detail to book and pay (mocked)', () => {
  test.use({ storageState: HAS_CUSTOMER_STATE ? CUSTOMER_STATE : undefined });

  test('happy path: can open book flow and initiate mocked payment', async ({ page, request }) => {
    test.skip(!HAS_CUSTOMER_STATE, 'Customer storageState not available');

    await page.goto('/');
    await page.locator('[data-testid="activity-card"], article:has(a[href^="/activity/"])').first().click();
    await expect(page).toHaveURL(/\/activity\//, { timeout: 10000 });
    await page.getByRole('button', { name: /book|reserve|احجز|حجز/i }).first().click();
    await expect(page).toHaveURL(/\/activity\/.*\/book/, { timeout: 10000 });

    const bookingRes = await request.get('/api/bookings/my?page=1&limit=1');
    test.skip(!bookingRes.ok(), 'Unable to read customer bookings');
    const bookingData = (await bookingRes.json()) as { data?: Array<{ id: string }> };
    const bookingId = bookingData.data?.[0]?.id;
    test.skip(!bookingId, 'No booking available to run payment step');

    let mockedCalled = false;
    await page.route('**/api/payment/initiate', async (route) => {
      mockedCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          formAction: 'https://payments.pay2m.com/mock-checkout',
          formFields: { orderId: 'pw-e2e-123', amount: '100.00' },
        }),
      });
    });

    await page.goto(`/bookings/${bookingId}`);
    await expect(page.getByRole('button', { name: /proceed to payment|connecting payment|متابعة الدفع/i })).toBeVisible();
    await page.getByRole('button', { name: /proceed to payment|متابعة الدفع/i }).click();

    await expect.poll(() => mockedCalled).toBe(true);
  });

  test('error path: payment initiate failure shows error message', async ({ page, request }) => {
    test.skip(!HAS_CUSTOMER_STATE, 'Customer storageState not available');

    const bookingRes = await request.get('/api/bookings/my?page=1&limit=1');
    test.skip(!bookingRes.ok(), 'Unable to read customer bookings');
    const bookingData = (await bookingRes.json()) as { data?: Array<{ id: string }> };
    const bookingId = bookingData.data?.[0]?.id;
    test.skip(!bookingId, 'No booking available to run payment failure case');

    await page.route('**/api/payment/initiate', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'PAYMENT_INIT_FAILED' }),
      });
    });

    await page.goto(`/bookings/${bookingId}`);
    await page.getByRole('button', { name: /proceed to payment|متابعة الدفع/i }).click();
    await expect(page.getByText(/could not start payment|please try again|فشل|الدفع/i)).toBeVisible({ timeout: 10000 });
  });
});
