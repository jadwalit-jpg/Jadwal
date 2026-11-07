/**
 * E2E — admin "Cancel booking" action on the bookings list.
 *
 * Opens the confirmation for a confirmed booking and dismisses it. Deliberately
 * never confirms: the seeded bookings are shared with the other specs in the
 * shard, and the server-side cancel is covered by the API integration tests.
 */
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
test.describe('Admin cancel booking', () => {
  test.use({ storageState: ADMIN_STATE });

  test('happy: confirmed booking shows Cancel booking, dialog opens and can be dismissed', async ({ page }) => {
    await page.goto('/admin/bookings');
    await page.waitForLoadState('networkidle');

    // Filter to confirmed bookings (custom dropdown: trigger button, then an option button).
    await page.getByRole('button', { name: /all statuses|all|الجميع|الكل|status|الحالة/i }).first().click();
    await page.getByRole('button', { name: /^confirmed$|^مؤكد/i }).first().click();
    await page.waitForLoadState('networkidle');

    const rows = page.locator('tbody tr');
    test.skip((await rows.count()) === 0, 'no confirmed booking in the seed');

    // Expand the first row; the action lives in the expanded detail panel.
    await rows.first().click();
    const cancelButton = page.getByRole('button', { name: 'Cancel booking' }).first();
    await expect(cancelButton).toBeVisible();
    await cancelButton.click();

    const dialog = page.getByRole('dialog', { name: 'Cancel booking' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Amount paid')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel booking' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Keep booking' }).click();
    await expect(dialog).toBeHidden();
    // Still on the list, nothing changed.
    await expect(page.getByRole('heading', { name: /bookings|الحجوزات/i }).first()).toBeVisible();
  });

  test('error: completed and cancelled bookings offer no Cancel booking action', async ({ page }) => {
    await page.goto('/admin/bookings');
    await page.waitForLoadState('networkidle');

    for (const option of [/^completed$|^مكتمل/i, /^cancelled$|^ملغ/i]) {
      await page.getByRole('button', { name: /all statuses|all|الجميع|الكل|status|الحالة|completed|cancelled|مكتمل|ملغ/i }).first().click();
      await page.getByRole('button', { name: option }).first().click();
      await page.waitForLoadState('networkidle');
      const rows = page.locator('tbody tr');
      if ((await rows.count()) === 0) continue;
      await rows.first().click();
      await expect(page.getByRole('button', { name: 'Cancel booking' })).toHaveCount(0);
    }
  });
});
