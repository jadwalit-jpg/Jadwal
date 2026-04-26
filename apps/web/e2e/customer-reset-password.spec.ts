/**
 * E2E — customer reset-password landing.
 *
 * The page is purely client-rendered: a missing token shows the
 * "Invalid Reset Link" branch; any non-empty token renders the
 * "Set New Password" form. Token validation runs only on submit
 * (no GET /validate-reset-token endpoint exists).
 */
import { test, expect } from '@playwright/test';

test.describe('Customer reset-password landing', () => {
  test('happy: no token → "Invalid Reset Link" branch', async ({ page }) => {
    await page.goto('/reset-password');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('heading', { name: /invalid reset link|invalid|expired|غير صالح|انتهت/i }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('error: with any non-empty token → "Set New Password" form renders', async ({ page }) => {
    await page.goto('/reset-password?token=bogus');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('heading', { name: /set new password|password reset|كلمة المرور/i }),
    ).toBeVisible({ timeout: 10000 });
    // Form should expose a password field.
    await expect(page.getByLabel(/new password|كلمة/i).first()).toBeVisible();
  });
});
