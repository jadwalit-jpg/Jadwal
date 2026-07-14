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

  /**
   * Regression: the admin cover uploader POSTed to `/upload/image` — an endpoint
   * that NEVER EXISTED. Every upload 404'd into a catch and surfaced as "Upload
   * failed", so an admin could never change an activity's cover image. It reached
   * production because NO E2E spec anywhere uploaded a file (`setInputFiles` did
   * not appear once in the suite) — this page's only coverage was a smoke check
   * that loaded the form and never touched the uploader.
   *
   * This asserts the upload request actually succeeds, so a dead/misrouted
   * endpoint fails the build instead of silently shipping.
   */
  test('happy: admin can upload a cover image (upload must not 404)', async ({ page }) => {
    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';
    const list = await page.request.get(`${apiBase}/admin/activities?page=1&limit=1`).catch(() => null);
    test.skip(!list || !list.ok(), 'Could not fetch admin activities');
    const body = (await list!.json().catch(() => null)) as { data?: Array<{ id: string }> } | null;
    const activityId = body?.data?.[0]?.id;
    test.skip(!activityId, 'No activities to edit — seed an activity first');

    await page.goto(`/admin/activities/${activityId}`);
    await page.waitForLoadState('networkidle');

    // The edit form is a 6-step wizard and the cover uploader lives on step 5
    // ("Media") — it simply is not in the DOM on step 1. Jump there via the step
    // indicator; handleStepClick allows moving forward as long as the earlier
    // steps validate, which they do for an already-saved (valid) activity.
    await page.getByRole('button', { name: /media/i }).first().click();
    await expect(
      page.getByText(/cover image/i).first(),
      'did not reach the Media step — an earlier step failed validation',
    ).toBeVisible({ timeout: 15_000 });

    // Fail fast with a readable message rather than hanging inside setInputFiles.
    const fileInput = page.locator('input[type="file"]').first();
    await expect(
      fileInput,
      'cover file input not found on the Media step',
    ).toBeAttached({ timeout: 15_000 });

    // The upload POST — this is what 404'd.
    const uploadDone = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /upload/i.test(r.url()),
      { timeout: 30_000 },
    );

    // 1×1 PNG; the page re-encodes to WebP client-side before sending.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    await fileInput.setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: png });

    const res = await uploadDone;
    expect(
      res.status(),
      `cover upload POST ${res.url()} returned ${res.status()} — the endpoint is missing or rejecting the admin`,
    ).toBeLessThan(400);

    // And the UI must not be showing the failure state.
    await expect(page.getByText(/upload failed/i)).toHaveCount(0);
  });
});
