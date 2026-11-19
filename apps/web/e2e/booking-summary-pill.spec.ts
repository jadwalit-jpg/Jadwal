/**
 * E2E — the summary pill under the booking page title ("Min 1 night · QAR …")
 * looked tappable and did nothing (Clarity showed taps on it). It is now a
 * button that scrolls to the date picker.
 */
import { test, expect } from '@playwright/test';

const SLUG = 'e2e-calendar-daily'; // seeded DAILY listing with a calendar

test.describe('Booking page summary pill', () => {
  test('happy: tapping the pill brings the date picker into view', async ({ page }) => {
    await page.goto(`/activity/${SLUG}/book`, { waitUntil: 'domcontentloaded' });
    const pill = page.getByTestId('booking-summary-pill');
    await expect(pill).toBeVisible({ timeout: 30_000 });
    const dates = page.getByTestId('booking-dates');
    await expect(dates).toBeVisible({ timeout: 30_000 });

    // Start from the bottom so the scroll the tap causes is observable.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await pill.click(); // Playwright scrolls the pill into view first, then taps it

    await expect.poll(async () => {
      const box = await dates.boundingBox();
      return box ? Math.round(box.y) : Number.NaN;
    }, { timeout: 5_000 }).toBeLessThanOrEqual(120);
    const viewport = page.viewportSize()!;
    const box = await dates.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(-5);
    expect(box!.y).toBeLessThan(viewport.height);
  });
});
