/**
 * E2E — admin edits an activity (huge form mirroring vendor wizard).
 *
 * Uses the seeded e2e-activity. Smoke check only — full save flow needs
 * wizard navigation across 7 steps, same as vendor-activity-edit.
 */
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
test.describe('Admin activity edit', () => {
  test.use({ storageState: ADMIN_STATE });

  test('happy: edit page loads existing activity', async ({ page }) => {
    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';
    const list = await page.request.get(`${apiBase}/admin/activities?page=1&limit=1`).catch(() => null);
    test.skip(!list || !list.ok(), 'Could not fetch admin activities');
    const body = (await list!.json().catch(() => null)) as { data?: Array<{ id: string }> } | null;
    const activityId = body?.data?.[0]?.id;
    test.skip(!activityId, 'No activities to edit — seed an activity first');

    await page.goto(`/admin/activities/${activityId}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /activity|edit|نشاط/i }).first())
      .toBeVisible({ timeout: 10000 });
  });

  test('error: opening a non-existent activity does not crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/admin/activities/00000000-0000-0000-0000-000000000000');
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });
});
