/**
 * E2E — admin "Cancel booking" action on the bookings list.
 *
 * Opens the confirmation for a confirmed booking and dismisses it. Deliberately
 * never confirms: the seeded bookings are shared with the other specs in the
 * shard, and the server-side cancel is covered by the API integration tests.
 */
import { test, expect, type Page } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';

/** The list renders a placeholder <tr> ("No bookings found.") when empty, so count rows by content. */
async function hasBookingRows(page: Page): Promise<boolean> {
  const empty = await page.getByText('No bookings found.').isVisible().catch(() => false);
  return !empty && (await page.locator('tbody tr').count()) > 0;
}

/** Pick a status in the custom dropdown (trigger button, then an option button). */
async function filterStatus(page: Page, option: RegExp) {
  await page.getByRole('button', { name: /all statuses|confirmed|completed|cancelled|pending|الجميع|الكل|الحالة/i }).first().click();
  await page.getByRole('button', { name: option }).first().click();
  await page.waitForLoadState('networkidle');
}

/** Expand the first row and wait for its detail panel (the "Dates" label only exists there). */
async function expandFirstRow(page: Page) {
  await page.locator('tbody tr').first().click();
  await expect(page.getByText('Dates', { exact: true }).first()).toBeVisible();
}

test.describe('Admin cancel booking', () => {
  test.use({ storageState: ADMIN_STATE });

  test('happy: confirmed booking shows Cancel booking, dialog opens and can be dismissed', async ({ page }) => {
    await page.goto('/admin/bookings');
    await page.waitForLoadState('networkidle');
    await filterStatus(page, /^confirmed$|^مؤكد/i);
    test.skip(!(await hasBookingRows(page)), 'no confirmed booking in the seed');

    await expandFirstRow(page);
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

    let checked = 0;
    for (const option of [/^completed$|^مكتمل/i, /^cancelled$|^ملغ/i]) {
      await filterStatus(page, option);
      if (!(await hasBookingRows(page))) continue;
      await expandFirstRow(page);
      await expect(page.getByRole('button', { name: 'Cancel booking' })).toHaveCount(0);
      checked++;
    }
    test.skip(checked === 0, 'no completed or cancelled booking in the seed');
  });
});
