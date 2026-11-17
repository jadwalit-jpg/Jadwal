/**
 * E2E — paid add-ons on the booking page and the listing page.
 *
 * The e2e seed gives the calendar chalet three add-ons: VIP cabin (per
 * person, whole group), Lunch box (per person) and Photographer (per
 * booking). Runs on chromium and mobile-chrome.
 */
import { test, expect, type Page } from '@playwright/test';

const SLUG = 'e2e-calendar-daily';

async function openBookingPage(page: Page) {
  await page.goto(`/activity/${SLUG}/book`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('booking-addons')).toBeVisible({ timeout: 30_000 });
}

test.describe('Booking page add-ons', () => {
  test('happy: the add-ons sit under the guests and before the price breakdown, every control is at least 44px, and the whole-group switch follows the guest count', async ({ page, isMobile }) => {
    await openBookingPage(page);
    const addons = page.getByTestId('booking-addons');
    const breakdownHeading = page.getByRole('heading', { name: /price breakdown|تفاصيل السعر/i }).first();
    await expect(breakdownHeading).toBeVisible();

    // Document order: add-ons before the breakdown (on a phone the columns stack, so this is what the customer scrolls past first).
    const before = await addons.evaluate((el, headingText) => {
      const headings = Array.from(document.querySelectorAll('h3'));
      const h = headings.find((x) => (x.textContent ?? '').trim().toLowerCase().includes(headingText));
      return h ? Boolean(el.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
    }, 'price breakdown');
    expect(before).toBe(true);
    if (isMobile) {
      // On a phone the columns stack: the add-ons are above the breakdown on screen too.
      const addonsBox = await addons.boundingBox();
      const breakdownBox = await breakdownHeading.boundingBox();
      expect(addonsBox!.y).toBeLessThan(breakdownBox!.y);
    }

    // Controls: the whole-group switch, the per-person buttons and the per-booking row.
    for (const id of ['addon-0-switch', 'addon-1-minus', 'addon-1-plus']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.height, id).toBeGreaterThanOrEqual(44);
      expect(box!.width, id).toBeGreaterThanOrEqual(44);
    }
    const checkboxRow = await page.getByTestId('addon-2').locator('label').boundingBox();
    expect(checkboxRow!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId('addon-1')).toContainText(/per person|للشخص/);

    // Whole group: on, and it follows the guest count.
    const sw = page.getByTestId('addon-0-switch');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(sw).toContainText(/× 1 guests|× 1 ضيوف/);
    const guestsStepper = page.getByRole('group', { name: /guests|الضيوف/i }).first();
    const increase = guestsStepper.getByRole('button', { name: 'Increase' });
    await increase.click();
    await increase.click();
    await expect(sw).toContainText(/× 3 guests|× 3 ضيوف/);
    await expect(sw).toContainText(/300/);
  });
});

test.describe('Listing page add-ons carry to the booking page', () => {
  test('happy: choose the whole-group add-on on the listing, tap Book, and it is on at the booking page', async ({ page }) => {
    await page.goto(`/activity/${SLUG}`, { waitUntil: 'domcontentloaded' });
    const sw = page.getByTestId('listing-addon-0-switch');
    await expect(sw).toBeVisible({ timeout: 30_000 });
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: /book now|احجز الآن/i }).first().click();
    await expect(page).toHaveURL(new RegExp(`/activity/${SLUG}/book`), { timeout: 30_000 });
    await expect(page.getByTestId('addon-0-switch')).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
  });
});
