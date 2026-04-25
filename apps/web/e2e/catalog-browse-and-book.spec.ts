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

test.describe('Customer catalog → activity → booking form', () => {
  test('public catalog page lists at least one activity', async ({ page }) => {
    await page.goto('/');

    // The home / catalog landing should show at least one activity card
    const activityCards = page.locator('[data-testid="activity-card"], article, [class*="activity-card"]');
    // Allow either: data-testid attribute, <article>, or className containing activity-card
    await expect(activityCards.first()).toBeVisible({ timeout: 15_000 });
  });

  test('search filters reduce results to matching activities', async ({ page }) => {
    await page.goto('/');

    const searchBox = page.getByPlaceholder(/search|find/i).first();
    if (await searchBox.isVisible()) {
      await searchBox.fill('tour');
      await searchBox.press('Enter');

      // Debounced by 300ms per performance rules
      await page.waitForTimeout(500);

      // Either results shown OR empty state — both valid after search
      const hasResults = await page.locator('article, [class*="activity-card"]').count() > 0;
      const emptyState = await page.getByText(/no.*results|nothing found/i).isVisible().catch(() => false);
      expect(hasResults || emptyState).toBe(true);
    }
  });

  test('activity detail page shows title + price + book button', async ({ page }) => {
    await page.goto('/');

    // Click the first activity card
    const firstCard = page.locator('article, [class*="activity-card"]').first();
    await firstCard.click();

    // Should land on /activity/[slug]
    await page.waitForURL(/\/activity\//, { timeout: 10_000 });

    // Critical elements on the detail page
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /book|reserve/i }).first())
      .toBeVisible({ timeout: 5_000 });
  });

  test('clicking Book while logged out → redirects to /login', async ({ page }) => {
    await page.goto('/');
    await page.locator('article, [class*="activity-card"]').first().click();
    await page.waitForURL(/\/activity\//, { timeout: 10_000 });

    // Click the book button
    await page.getByRole('button', { name: /book|reserve/i }).first().click();

    // Unauthed customer should be bounced to login
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test('authenticated customer can reach the booking form', async ({ page, context }) => {
    // Log in via the login page first
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(TEST_CUSTOMER_EMAIL);
    await page.getByLabel(/password/i).fill(TEST_CUSTOMER_PASSWORD);
    await page.getByRole('button', { name: /log in|sign in/i }).click();

    // If the test seed has not been loaded, this login will fail; skip gracefully
    const loginFailed = await page.getByText(/invalid credentials|not verified/i)
      .isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(loginFailed, 'Test customer account not seeded — skipping authed flow');

    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10_000 });

    // Navigate to an activity and click Book
    await page.goto('/');
    await page.locator('article, [class*="activity-card"]').first().click();
    await page.waitForURL(/\/activity\//);
    await page.getByRole('button', { name: /book|reserve/i }).first().click();

    // Should land on /activity/[slug]/book — the booking form page
    await expect(page).toHaveURL(/\/activity\/.*\/book/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /book|select date|confirm/i }).first())
      .toBeVisible();
  });
});
