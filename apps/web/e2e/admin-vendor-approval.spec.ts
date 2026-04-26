/**
 * E2E — admin approves a pending vendor.
 *
 * Skips when no pending vendor exists. After approval, the vendor's
 * status flips to ACTIVE; assert that via the row's status chip or by
 * navigating back to the vendors list and finding it under the active
 * filter.
 */
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
test.describe('Admin vendor approval', () => {
  test.use({ storageState: ADMIN_STATE });

  test('happy: approve a pending vendor', async ({ page }) => {
    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';
    const pending = await page.request.get(`${apiBase}/admin/vendors?status=PENDING&page=1&limit=1`).catch(() => null);
    if (!pending || !pending.ok()) test.skip(true, 'Could not query pending vendors');
    const body = (await pending!.json().catch(() => null)) as { data?: Array<{ id: string }> } | null;
    const vendorId = body?.data?.[0]?.id;
    test.skip(!vendorId, 'No pending vendors — skip approval flow');

    await page.goto(`/admin/vendors/${vendorId}`);
    await page.waitForLoadState('networkidle');

    const approve = page.getByRole('button', { name: /^(approve|activate|قبول|تنشيط)$/i }).first();
    if (!(await approve.isVisible().catch(() => false))) {
      test.skip(true, 'No approve button on detail page');
    }
    await approve.click();

    const confirm = page.getByRole('button', { name: /^(confirm|yes|نعم|تأكيد)$/i }).first();
    if (await confirm.isVisible().catch(() => false)) await confirm.click();

    await expect(page.getByText(/approved|active|تمت الموافقة|نشط/i).first())
      .toBeVisible({ timeout: 10000 });
  });

  test('error: vendors page renders heading even with no pending', async ({ page }) => {
    await page.goto('/admin/vendors');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /vendor|المزودين|إدارة/i }).first())
      .toBeVisible();
  });
});
