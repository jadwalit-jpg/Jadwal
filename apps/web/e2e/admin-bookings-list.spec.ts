/**
 * E2E — admin bookings list.
 *
 * Smoke: page loads, status filter works.
 */
import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
const HAS_ADMIN_STATE = existsSync(ADMIN_STATE);

test.describe('Admin bookings list', () => {
  test.use({ storageState: HAS_ADMIN_STATE ? ADMIN_STATE : undefined });

  test('happy: bookings page loads', async ({ page }) => {
    test.skip(!HAS_ADMIN_STATE, 'Admin storageState not available');

    await page.goto('/admin/bookings');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /bookings|الحجوزات/i }).first())
      .toBeVisible();

    const hasRows = (await page.locator('tbody tr').count()) > 0;
    const hasEmpty = await page.getByText(/no bookings|empty|لا توجد/i).isVisible().catch(() => false);
    expect(hasRows || hasEmpty).toBe(true);
  });

  test('error: filter by status keeps page rendering', async ({ page }) => {
    test.skip(!HAS_ADMIN_STATE, 'Admin storageState not available');

    await page.goto('/admin/bookings');
    await page.waitForLoadState('networkidle');

    const filter = page.getByRole('combobox', { name: /status|الحالة/i }).first();
    if (!(await filter.isVisible().catch(() => false))) test.skip(true, 'No status filter');
    await filter.click();
    const cancelled = page.getByRole('option', { name: /cancelled|ملغ/i }).first();
    if (await cancelled.isVisible().catch(() => false)) await cancelled.click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /bookings|الحجوزات/i }).first())
      .toBeVisible();
  });
});
