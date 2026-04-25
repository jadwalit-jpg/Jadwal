import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';
const HAS_CUSTOMER_STATE = existsSync(CUSTOMER_STATE);

test.describe('Customer login + my bookings', () => {
  test.use({ storageState: HAS_CUSTOMER_STATE ? CUSTOMER_STATE : undefined });

  test('happy path: authenticated customer sees bookings page', async ({ page }) => {
    test.skip(!HAS_CUSTOMER_STATE, 'Customer storageState not available');

    await page.goto('/bookings');
    await expect(page).toHaveURL(/\/bookings/);
    await expect(page.getByRole('heading', { name: /my bookings|حجوزاتي/i })).toBeVisible();

    const hasCards = await page.locator('article').first().isVisible().catch(() => false);
    const hasEmptyState = await page
      .getByText(/no bookings yet|لا توجد حجوزات|browse activities/i)
      .first()
      .isVisible()
      .catch(() => false);
    expect(hasCards || hasEmptyState).toBe(true);
  });

  test('error path: cleared session redirects to login', async ({ page, context }) => {
    test.skip(!HAS_CUSTOMER_STATE, 'Customer storageState not available');

    await context.clearCookies();
    await page.goto('/bookings');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });
});
