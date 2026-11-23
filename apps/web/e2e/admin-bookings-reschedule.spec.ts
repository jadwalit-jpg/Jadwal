/**
 * E2E — admin "Change date" on the bookings list.
 *
 * Moves JDWL-E2ERSCH (confirmed, card-paid, seeded 15 days out at 10:00) to
 * "Next Week" at 14:00 through the real API, then checks the row shows the
 * change and the dialog refuses a second move to the same dates. A second
 * run on the same database picks 15:00 instead (the booking is already on
 * 14:00), so the spec is order- and rerun-independent; reseeding resets it.
 */
import { test, expect, type Page } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
const REF = 'JDWL-E2ERSCH';

async function openBookingRow(page: Page) {
  await page.goto('/admin/bookings');
  await page.waitForLoadState('networkidle');
  const loaded = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().includes('/admin/bookings') && r.url().includes(REF));
  await page.getByPlaceholder(/search/i).first().fill(REF);
  await loaded;
  await expect(page.locator('tbody tr').first()).toBeVisible();
  test.skip(await page.getByText('No bookings found.').isVisible().catch(() => false), 'reschedule fixture not seeded');
  await page.locator('tbody tr').first().click();
  await expect(page.getByText('Dates', { exact: true }).first()).toBeVisible();
}

test.describe('Admin change booking date', () => {
  test.use({ storageState: ADMIN_STATE });

  test('happy: pick next week + a start time, check price, give a reason, confirm; the row shows the change', async ({ page }) => {
    await openBookingRow(page);
    await page.getByRole('button', { name: 'Change date' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Change date' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('reschedule-current')).toContainText(/\d{4}/);
    await expect(dialog.getByRole('button', { name: 'Change date' })).toBeDisabled();

    // Date: the picker's "Next Week" preset (today + 7).
    const slotsLoaded = page.waitForResponse((r) => r.url().includes('/availability/hourly/'));
    await dialog.getByRole('button', { name: 'Pick a date' }).click();
    await dialog.getByRole('button', { name: 'Next Week' }).click();
    await slotsLoaded;
    const slot = dialog.locator('#reschedule-slot');
    await expect(slot).toBeEnabled();
    await expect(slot.locator('option[value="14:00"]')).toHaveCount(1);
    await slot.selectOption('14:00');

    // Preview: price and difference. If this run is a repeat and the booking
    // is already on 14:00, the server says so; use 15:00 instead.
    const check = dialog.getByRole('button', { name: 'Check availability and price' });
    let previewed = page.waitForResponse((r) => r.url().includes('/reschedule-preview'));
    await check.click();
    await previewed;
    if (await dialog.getByTestId('reschedule-error').isVisible().catch(() => false)) {
      await expect(dialog.getByTestId('reschedule-error')).toContainText(/already on these dates/);
      await slot.selectOption('15:00');
      previewed = page.waitForResponse((r) => r.url().includes('/reschedule-preview'));
      await check.click();
      await previewed;
    }
    await expect(dialog.getByTestId('reschedule-preview')).toBeVisible();
    await expect(dialog.getByTestId('reschedule-difference')).toContainText('QAR');
    // Same base price on the seed activity: nothing to settle.
    await expect(dialog.getByTestId('reschedule-settlement')).toHaveCount(0);

    await dialog.getByLabel(/Reason/).fill('E2E: customer asked to move the trip');
    const confirm = dialog.getByRole('button', { name: 'Change date' });
    await expect(confirm).toBeEnabled();
    const posted = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/reschedule'));
    await confirm.click();
    const res = await posted;
    expect(res.status()).toBe(201);
    await expect(dialog).toBeHidden();

    // The list refetches: badge on the row, the change record in the panel.
    // The row we expanded stays expanded across the refetch; re-open it only
    // if the refetch collapsed it.
    await expect(page.getByTestId('date-changed-badge').first()).toBeVisible();
    const record = page.getByTestId('date-change-record');
    if (!(await record.isVisible().catch(() => false))) {
      await page.locator('tbody tr').first().click();
    }
    await expect(record).toBeVisible();
    await expect(record).toContainText('Moved on');
    await expect(record).toContainText('No price change');
    await expect(record).toContainText('E2E: customer asked to move the trip');
  });

  test('edge: the dialog refuses the dates the booking is already on', async ({ page }) => {
    await openBookingRow(page);
    // The previous test moved the booking to next week 14:00 (or 15:00); the
    // row's time cell tells us which.
    const timeCell = await page.locator('tbody tr').first().locator('td').nth(3).innerText();
    const current = /15:00/.test(timeCell) ? '15:00' : '14:00';
    await page.getByRole('button', { name: 'Change date' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Change date' });
    const slotsLoaded = page.waitForResponse((r) => r.url().includes('/availability/hourly/'));
    await dialog.getByRole('button', { name: 'Pick a date' }).click();
    await dialog.getByRole('button', { name: 'Next Week' }).click();
    await slotsLoaded;
    await dialog.locator('#reschedule-slot').selectOption(current);
    const previewed = page.waitForResponse((r) => r.url().includes('/reschedule-preview'));
    await dialog.getByRole('button', { name: 'Check availability and price' }).click();
    expect((await previewed).status()).toBe(400);
    await expect(dialog.getByTestId('reschedule-error')).toContainText(/already on these dates/);
    await expect(dialog.getByRole('button', { name: 'Change date' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Keep dates' }).click();
    await expect(dialog).toBeHidden();
  });
});
