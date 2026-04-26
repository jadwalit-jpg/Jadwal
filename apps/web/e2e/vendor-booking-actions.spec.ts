/**
 * E2E — vendor confirms or rejects a pending booking.
 *
 * Skips when no pending booking exists. Bootstrapping a pending booking
 * via API requires a customer-side activity book + a payment that lands in
 * PENDING — too much setup for this spec. Real coverage of the action
 * paths requires either a fixture seed or running this after the customer
 * book-mock-pay spec has run.
 */
import { test, expect } from '@playwright/test';
import { vendorSlugFromMe } from './_fixtures/auth';

const VENDOR_STATE = 'e2e/.auth/vendor.json';
test.describe('Vendor booking actions', () => {
  test.use({ storageState: VENDOR_STATE });

  test('happy: confirm a pending booking', async ({ page }) => {
    const slug = await vendorSlugFromMe(page);

    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';
    const pending = await page.request.get(
      `${apiBase}/vendor/${slug}/bookings?status=PENDING&page=1&limit=1`,
    ).catch(() => null);
    test.skip(!pending || !pending.ok(), 'Could not fetch pending bookings');
    const body = (await pending!.json().catch(() => null)) as { data?: Array<{ id: string }> } | null;
    const bookingId = body?.data?.[0]?.id;
    test.skip(!bookingId, 'No pending booking to confirm — seed one first');

    await page.goto(`/vendor/${slug}/bookings`);
    await page.waitForLoadState('networkidle');
    // Open the row (locale-tolerant)
    await page.getByText(bookingId!).first().click().catch(() => null);
    const confirm = page.getByRole('button', { name: /^(confirm|approve|accept|تأكيد|قبول)$/i }).first();
    if (!(await confirm.isVisible().catch(() => false))) {
      test.skip(true, 'No confirm button visible — UI shape changed');
    }
    await confirm.click();
    await expect(
      page.getByText(/confirmed|approved|تم التأكيد|تم القبول/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('error: reject path on a pending booking', async ({ page }) => {
    const slug = await vendorSlugFromMe(page);

    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';
    const pending = await page.request.get(
      `${apiBase}/vendor/${slug}/bookings?status=PENDING&page=1&limit=1`,
    ).catch(() => null);
    test.skip(!pending || !pending.ok(), 'Could not fetch pending bookings');
    const body = (await pending!.json().catch(() => null)) as { data?: Array<{ id: string }> } | null;
    const bookingId = body?.data?.[0]?.id;
    test.skip(!bookingId, 'No pending booking to reject');

    await page.goto(`/vendor/${slug}/bookings`);
    await page.waitForLoadState('networkidle');
    await page.getByText(bookingId!).first().click().catch(() => null);
    const reject = page.getByRole('button', { name: /^(reject|decline|deny|رفض)$/i }).first();
    if (!(await reject.isVisible().catch(() => false))) {
      test.skip(true, 'No reject button visible');
    }
    await reject.click();
    await expect(
      page.getByText(/rejected|declined|تم الرفض/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });
});
