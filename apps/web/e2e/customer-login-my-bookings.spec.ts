import { test, expect } from '@playwright/test';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';
test.describe('Customer login + my bookings', () => {
  test.use({ storageState: CUSTOMER_STATE });

  test('happy path: authenticated customer sees bookings page', async ({ page }) => {
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/bookings/);
    await expect(page.getByRole('heading', { name: /my bookings|حجوزاتي/i })).toBeVisible();

    // List can render either booking cards (article) or an empty state. Use
    // toBeVisible() with a timeout instead of isVisible() (which is sync) so
    // the assertion polls while React Query settles.
    const cardOrEmpty = page
      .locator('article, p:has-text("No bookings yet"), p:has-text("لا توجد حجوزات"), button:has-text("Browse Activities"), button:has-text("تصفح")')
      .first();
    await expect(cardOrEmpty).toBeVisible({ timeout: 10000 });
  });

  test('error path: cleared session redirects to login', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/bookings');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });
});
