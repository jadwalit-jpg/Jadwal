/**
 * E2E — auth boundary: unauthenticated visitor on protected routes is
 * redirected to the appropriate login page; 401 on /auth/me triggers a
 * client-side logout-and-redirect.
 */
import { test, expect } from '@playwright/test';

test.describe('Auth boundaries — protected routes redirect anonymously', () => {
  // Empty storage state → no cookies → all calls unauthenticated.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('GET /bookings (customer protected) redirects to /login', async ({ page }) => {
    await page.goto('/bookings');
    await page.waitForLoadState('domcontentloaded');
    // Either the page itself redirects, or a guard pushes to /login.
    // Allow up to 10s for client-side guards to fire.
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('GET /admin/dashboard redirects to /admin/login', async ({ page }) => {
    await page.goto('/admin/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/\/admin\/login/, { timeout: 10000 });
  });

  test('GET /vendor/[slug]/dashboard redirects (login or vendor-register)', async ({ page }) => {
    await page.goto('/vendor/any-slug/dashboard');
    await page.waitForLoadState('domcontentloaded');
    // Vendor RoleGuard may push to /register/vendor or /login depending
    // on the absence of any auth state. Both signal "blocked".
    await expect(page).toHaveURL(/\/(login|register\/vendor)/, { timeout: 10000 });
  });

  test('401 on /auth/me triggers logout/redirect on protected page', async ({ page }) => {
    // Force /auth/me to return 401 the moment any page polls it.
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 401, message: 'Unauthorized' }),
      });
    });
    // Navigate to a protected page; the AuthContext should clear state
    // and redirect to /login when /auth/me 401s.
    await page.goto('/profile');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });
});
