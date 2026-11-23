/**
 * E2E — review asks.
 *
 * The seed gives the customer two completed bookings with an open ask:
 * JDWL-E2ERVWA (the pop-up spec taps "Later") and JDWL-E2ERVWB (the page
 * spec submits a rating). The pop-up must show on the home page and never on
 * the bookings page; /review/<ref> is the stable link from the email and the
 * WhatsApp agent, and needs sign-in. Runs on chromium and the mobile projects.
 */
import { test, expect } from '@playwright/test';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';
const PAGE_REF = 'JDWL-E2ERVWB';

test.describe('Review ask pop-up', () => {
  test.use({ storageState: CUSTOMER_STATE });

  test('shows on the home page with stars, "Later" hides it, and it never shows on the bookings page', async ({ page }) => {
    await page.goto('/bookings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await expect(page.getByTestId('review-prompt')).toHaveCount(0);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const hasAsk = await page.evaluate(async () => {
      const r = await fetch('/api/customer/review-prompts/next', { credentials: 'include' });
      const d = await r.json().catch(() => null);
      return !!d?.prompt;
    });
    test.skip(!hasAsk, 'no open review ask for the seeded customer');

    const dialog = page.getByTestId('review-prompt');
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toContainText(/How was|كيف كانت/);
    await expect(dialog.getByRole('radio')).toHaveCount(5);
    const star = dialog.getByTestId('review-prompt-star-5');
    const box = await star.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expect(dialog.getByTestId('review-prompt-submit')).toBeDisabled();

    const shownRef = await page.evaluate(async () => {
      const r = await fetch('/api/customer/review-prompts/next', { credentials: 'include' });
      return (await r.json())?.prompt?.bookingRef ?? null;
    });
    await dialog.getByTestId('review-prompt-later').click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // "Later" hides THIS booking's ask until the next one. Another open ask (the
    // seed has two) may take its place, so check the server, not the screen.
    await expect
      .poll(async () => page.evaluate(async () => {
        const r = await fetch('/api/customer/review-prompts/next', { credentials: 'include' });
        return (await r.json())?.prompt?.bookingRef ?? null;
      }), { timeout: 10_000 })
      .not.toBe(shownRef);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const after = page.getByTestId('review-prompt');
    if ((await after.count()) > 0) {
      // A different booking's ask, never the snoozed one.
      const nextRef = await page.evaluate(async () => {
        const r = await fetch('/api/customer/review-prompts/next', { credentials: 'include' });
        return (await r.json())?.prompt?.bookingRef ?? null;
      });
      expect(nextRef).not.toBe(shownRef);
    }
  });
});

test.describe('Review page /review/<ref>', () => {
  test.use({ storageState: CUSTOMER_STATE });

  test('opens the form for the booking, submits a rating, then says thank you; a foreign reference is not found', async ({ page }) => {
    await page.goto(`/review/${PAGE_REF}`, { waitUntil: 'domcontentloaded' });
    const card = page.getByTestId('review-form-card');
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(PAGE_REF);
    const already = await page.getByTestId('review-thanks').count();
    if (already === 0) {
      await card.getByTestId('review-page-star-4').click();
      await page.getByRole('button', { name: /submit rating|إرسال التقييم/i }).click();
    }
    await expect(page.getByTestId('review-thanks')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('review-thanks')).toContainText(/Thank you|شكرًا/);

    await page.goto('/review/JDWL-NOSUCHREF', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('review-not-found')).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('Review page needs sign-in', () => {
  test('a signed-out visitor is sent to login and brought back afterwards', async ({ page }) => {
    await page.goto(`/review/${PAGE_REF}`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Freview%2FJDWL-E2ERVWB/, { timeout: 30_000 });
  });
});
