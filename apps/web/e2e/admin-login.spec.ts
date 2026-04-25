import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = 'admin@jadwal.com';
const ADMIN_PASSWORD = 'Admin123!';

test.describe('Admin login', () => {
  test('should show login page and sign in successfully', async ({ page }) => {
    await page.goto('/admin/login');

    await expect(page.getByRole('heading', { name: /Jadwal Admin/i })).toBeVisible();
    await expect(page.getByPlaceholder('admin@jadwal.com')).toBeVisible();
    await expect(page.getByPlaceholder('••••••••')).toBeVisible();

    await page.getByPlaceholder('admin@jadwal.com').fill(ADMIN_EMAIL);
    await page.getByPlaceholder('••••••••').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /Sign In/i }).click();

    // Wait for either redirect to dashboard or error message
    await page.waitForURL(/\/(admin\/dashboard|admin\/login)/, { timeout: 15000 });
    if (page.url().includes('/admin/login')) {
      const errEl = page.locator('[class*="bg-red-500"]').first();
      const errText = (await errEl.textContent().catch(() => '')) || 'No error message shown';
      throw new Error(`Login did not redirect. Page error: ${errText}`);
    }
    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await expect(page.getByText('Jadwal Admin')).toBeVisible();
    await expect(page.getByText('Dashboard')).toBeVisible();
  });

  test('should show error on invalid credentials', async ({ page }) => {
    await page.goto('/admin/login');

    await page.getByPlaceholder('admin@jadwal.com').fill('wrong@example.com');
    await page.getByPlaceholder('••••••••').fill('wrongpassword');
    await page.getByRole('button', { name: /Sign In/i }).click();

    await expect(page.getByText(/Invalid credentials|access denied/i)).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
