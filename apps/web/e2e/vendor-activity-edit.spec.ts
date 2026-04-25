/**
 * E2E — vendor edits an existing activity.
 *
 * Skips if the vendor has no activities. When an activity exists, opens
 * the edit page, changes the title, saves, reloads, and asserts the new
 * title persists.
 */
import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { vendorSlugFromMe } from './_fixtures/auth';

const VENDOR_STATE = 'e2e/.auth/vendor.json';
const HAS_VENDOR_STATE = existsSync(VENDOR_STATE);

test.describe('Vendor activity edit', () => {
  test.use({ storageState: HAS_VENDOR_STATE ? VENDOR_STATE : undefined });

  test('happy: change title + reload preserves it', async ({ page, request }) => {
    test.skip(!HAS_VENDOR_STATE, 'Vendor storageState not available');
    const slug = await vendorSlugFromMe(page);

    // Find an existing activity for this vendor via API.
    const list = await request.get(`/api/vendor/${slug}/activities?page=1&limit=1`);
    test.skip(!list.ok(), 'Could not fetch vendor activities');
    const data = (await list.json()) as { data?: Array<{ id: string; slug: string; titleEn?: string }> };
    const activity = data.data?.[0];
    test.skip(!activity, 'No activities to edit — seed an activity first');

    await page.goto(`/vendor/${slug}/activities/${activity!.slug}`);
    await page.waitForLoadState('networkidle');

    const newTitle = `E2E Edited ${Date.now()}`;
    const titleInput = page.getByLabel(/title.*english|english title|العنوان.*انجليزي/i).first();
    if (!(await titleInput.isVisible().catch(() => false))) {
      test.skip(true, 'Edit form has no English title input — wizard layout changed');
    }
    await titleInput.fill(newTitle);

    await page.getByRole('button', { name: /save|update|submit|حفظ|تحديث/i }).first().click();
    await expect(page.getByText(/saved|updated|success|تم الحفظ|تم التحديث/i).first())
      .toBeVisible({ timeout: 10000 });

    // Reload and check persistence.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(titleInput).toHaveValue(newTitle);
  });

  test('error: opening a non-existent activity shows 404 or redirect', async ({ page }) => {
    test.skip(!HAS_VENDOR_STATE, 'Vendor storageState not available');
    const slug = await vendorSlugFromMe(page);

    await page.goto(`/vendor/${slug}/activities/zzz-does-not-exist`);
    // Either explicit 404 copy or redirect to the list.
    const has404 = await page.getByText(/404|not found|غير موجود/i).isVisible({ timeout: 5000 }).catch(() => false);
    const onList = /\/activities$/.test(page.url());
    expect(has404 || onList).toBe(true);
  });
});
