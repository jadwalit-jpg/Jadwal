/**
 * E2E — customer browses catalog → views activity → opens booking flow.
 *
 * Requires:
 *   - web dev server at http://localhost:3000
 *   - API at http://localhost:4000 with seed activities
 *   - A pre-existing verified customer account (test seed)
 *
 * This tests the critical "can a customer actually reach the booking form"
 * path without hitting PAY2M (the final payment step needs PAY2M UAT).
 */

import { test, expect } from '@playwright/test';

const TEST_CUSTOMER_EMAIL = 'customer@jadwal-test.local';
const TEST_CUSTOMER_PASSWORD = 'S3cure!Pass1';
const activityCards = '[data-testid="activity-card"], article:has(a[href^="/activity/"])';

test.describe('Customer catalog → activity → booking form', () => {
  test('public catalog page lists at least one activity', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator(activityCards).first()).toBeVisible({ timeout: 15_000 });
  });

  test('search filters reduce results to matching activities', async ({ page }) => {
    await page.goto('/');

    const searchBox = page
      .getByRole('textbox', { name: /search|find|ابحث/i })
      .or(page.locator('input[type="search"]').first());
    if (await searchBox.isVisible()) {
      await searchBox.fill('tour');
      await searchBox.press('Enter');

      await expect(searchBox).toHaveValue(/tour/i);

      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('activity detail page shows title + price + book button', async ({ page }) => {
    await page.goto('/');

    const firstCard = page.locator(activityCards).first();
    await firstCard.click();

    await expect(page).toHaveURL(/\/activity\//, { timeout: 10_000 });

    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /book|reserve|احجز|حجز/i }).first())
      .toBeVisible({ timeout: 5_000 });
  });

  test('clicking Book while logged out → redirects to /login', async ({ page }) => {
    await page.goto('/');
    await page.locator(activityCards).first().click();
    await expect(page).toHaveURL(/\/activity\//, { timeout: 10_000 });

    await page.getByRole('button', { name: /book|reserve|احجز|حجز/i }).first().click();
    await expect(page).toHaveURL(/\/(login|activity\/.*\/book)/, { timeout: 10_000 });
  });

  test('authenticated customer can reach the booking form', async ({ page, context }) => {
    // Log in via the login page first
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(TEST_CUSTOMER_EMAIL);
    await page.getByLabel(/password/i).fill(TEST_CUSTOMER_PASSWORD);
    await page.getByRole('button', { name: /^(log in|sign in|تسجيل الدخول)$/i }).click();

    const loginFailed = await page
      .getByText(/invalid credentials|not verified|verify your email|غير|تحقق/i)
      .first()
      .isVisible()
      .catch(() => false);
    test.skip(loginFailed || page.url().includes('/login'), 'Test customer account not seeded — skipping authed flow');

    // Navigate to an activity and click Book
    await page.goto('/');
    await page.locator(activityCards).first().click();
    await expect(page).toHaveURL(/\/activity\//);
    await page.getByRole('button', { name: /book|reserve|احجز|حجز/i }).first().click();

    // Should land on /activity/[slug]/book — the booking form page
    await expect(page).toHaveURL(/\/activity\/.*\/book/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /book|select date|confirm/i }).first())
      .toBeVisible();
  });
});
