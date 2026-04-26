/**
 * E2E — customer goes through book + initiate-payment with PAY2M mocked.
 *
 * The "Proceed to Payment" button only renders on PENDING bookings, so
 * we explicitly fetch a PENDING booking (the seed always has one:
 * JDWL-E2EPND from prisma/seed-e2e-data.ts).
 *
 * Customer pages can show a PhonePrompt modal that intercepts pointer
 * events. Dismiss it via the "Skip for now" button before any clicks.
 */
import { test, expect, type Page } from '@playwright/test';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';

async function dismissPhonePrompt(page: Page) {
  // The PhonePrompt fetches /users/me asynchronously and only renders after
  // the API responds — give it up to 3s to appear before continuing.
  const skip = page.getByRole('button', { name: /^(skip for now|تخطي|لاحقا|لاحقًا)$/i }).first();
  await skip.waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined);
  if (await skip.isVisible().catch(() => false)) {
    await skip.click().catch(() => undefined);
    // Wait for the modal overlay to fully disappear before clicks fire.
    await skip.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => undefined);
  }
}

test.describe('Customer detail to book and pay (mocked)', () => {
  test.use({ storageState: CUSTOMER_STATE });

  test('happy path: can open book flow and initiate mocked payment', async ({ page }) => {
    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';
    const bookingRes = await page.request
      .get(`${apiBase}/bookings/my?status=PENDING&page=1&limit=1`)
      .catch(() => null);
    test.skip(!bookingRes || !bookingRes.ok(), 'Unable to read customer bookings');
    const bookingData = (await bookingRes!.json().catch(() => null)) as { data?: Array<{ id: string }> } | null;
    const bookingId = bookingData?.data?.[0]?.id;
    test.skip(!bookingId, 'No PENDING booking available to run payment step');

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
    await page.waitForLoadState('networkidle');
    await dismissPhonePrompt(page);

    await expect(
      page.getByRole('button', { name: /proceed to payment|connecting payment|متابعة الدفع/i }),
    ).toBeVisible();
    await page.getByRole('button', { name: /proceed to payment|متابعة الدفع/i }).click();

    await expect.poll(() => mockedCalled, { timeout: 10000 }).toBe(true);
  });

  test('error path: payment initiate failure shows error message', async ({ page }) => {
    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';
    const bookingRes = await page.request
      .get(`${apiBase}/bookings/my?status=PENDING&page=1&limit=1`)
      .catch(() => null);
    test.skip(!bookingRes || !bookingRes.ok(), 'Unable to read customer bookings');
    const bookingData = (await bookingRes!.json().catch(() => null)) as { data?: Array<{ id: string }> } | null;
    const bookingId = bookingData?.data?.[0]?.id;
    test.skip(!bookingId, 'No PENDING booking available to run payment failure case');

    await page.route('**/api/payment/initiate', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'PAYMENT_INIT_FAILED' }),
      });
    });

    await page.goto(`/bookings/${bookingId}`);
    await page.waitForLoadState('networkidle');
    await dismissPhonePrompt(page);

    await page.getByRole('button', { name: /proceed to payment|متابعة الدفع/i }).click();
    // The actual toast surfaces the API's error.response.data.message —
    // here that's our mocked "PAYMENT_INIT_FAILED" string. Accept either the
    // mocked code OR the frontend fallback ("Could not start payment...").
    await expect(
      page.getByText(/PAYMENT_INIT_FAILED|could not start payment|please try again|فشل|الدفع/i),
    ).toBeVisible({ timeout: 10000 });
  });
});
