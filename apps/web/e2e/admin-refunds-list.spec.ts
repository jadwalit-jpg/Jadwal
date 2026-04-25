/**
 * E2E — admin refunds list.
 *
 * Smoke: page loads. Approve flow is data-dependent — skip if empty.
 */
import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
const HAS_ADMIN_STATE = existsSync(ADMIN_STATE);

test.describe('Admin refunds list', () => {
  test.use({ storageState: HAS_ADMIN_STATE ? ADMIN_STATE : undefined });

  test('happy: refunds page loads', async ({ page }) => {
    test.skip(!HAS_ADMIN_STATE, 'Admin storageState not available');

    await page.goto('/admin/refunds');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /refund|استرداد/i }).first())
      .toBeVisible();
  });

  test('error: approve action visible if rows exist', async ({ page }) => {
    test.skip(!HAS_ADMIN_STATE, 'Admin storageState not available');

    await page.goto('/admin/refunds');
    await page.waitForLoadState('networkidle');

    const rows = await page.locator('tbody tr').count();
    if (rows === 0) test.skip(true, 'No refund rows to act on');

    const action = page.getByRole('button', { name: /approve|reject|action|قبول|رفض/i }).first();
    expect(await action.isVisible()).toBe(true);
  });
});
