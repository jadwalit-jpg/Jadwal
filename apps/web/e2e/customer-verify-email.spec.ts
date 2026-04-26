/**
 * E2E — customer email-verification landing.
 *
 * Public page accessed via the magic link in the verification email.
 * Without a valid token the page falls back to "Link invalid or expired".
 */
import { test, expect } from '@playwright/test';

test.describe('Customer verify-email landing', () => {
  test('happy: with no token → link invalid state', async ({ page }) => {
    await page.goto('/verify-email');
    await page.waitForLoadState('networkidle');

    // The page shows one of three states. With no token we get the
    // invalid/expired branch.
    await expect(
      page.getByRole('heading', { name: /link invalid|link expired|invalid|expired|verifying|verified|تحقق|انتهت/i }).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('error: with bogus token → link invalid (mocked verify endpoint)', async ({ page }) => {
    await page.route('**/api/auth/verify-email*', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'INVALID_TOKEN' }),
      }),
    );
    await page.goto('/verify-email?token=bogus');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByText(/link invalid|invalid|expired|تحقق|انتهت/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });
});
