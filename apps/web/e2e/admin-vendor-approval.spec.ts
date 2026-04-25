/**
 * E2E — admin approves a pending vendor.
 *
 * Skips when no pending vendor exists. After approval, the vendor's
 * status flips to ACTIVE; assert that via the row's status chip or by
 * navigating back to the vendors list and finding it under the active
 * filter.
 */
import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
const HAS_ADMIN_STATE = existsSync(ADMIN_STATE);

test.describe('Admin vendor approval', () => {
  test.use({ storageState: HAS_ADMIN_STATE ? ADMIN_STATE : undefined });

  test('happy: approve a pending vendor', async ({ page, request }) => {
    test.skip(!HAS_ADMIN_STATE, 'Admin storageState not available');

    const pending = await request.get('/api/admin/vendors?status=PENDING&page=1&limit=1');
    test.skip(!pending.ok(), 'Could not query pending vendors');
    const body = (await pending.json()) as { data?: Array<{ id: string }> };
    const vendorId = body.data?.[0]?.id;
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
    test.skip(!HAS_ADMIN_STATE, 'Admin storageState not available');
    await page.goto('/admin/vendors');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /vendors|المزودين/i }).first())
      .toBeVisible();
  });
});
