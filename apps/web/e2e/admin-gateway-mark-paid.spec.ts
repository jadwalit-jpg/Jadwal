/**
 * E2E — admin rescues a debit-card payment the site could not confirm.
 *
 * The seed has booking JDWL-E2EGWAY: PENDING, with a PAY2M payment whose
 * success callback (code 000) failed verification. The admin opens the
 * "Gateway payments to check" view, marks it as paid with the PAY2M
 * transaction id and a note, and the booking becomes CONFIRMED / Paid.
 * Chromium only (admin-* specs are skipped on the mobile projects).
 */
import { test, expect, type Page } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
const REF = 'JDWL-E2EGWAY';

async function openGatewayView(page: Page) {
  await page.goto('/admin/bookings?gateway=unconfirmed', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('gateway-payments')).toBeVisible({ timeout: 30_000 });
  // The list loads after the view renders: wait for rows or the empty state
  // before deciding anything, or an early count reads 0 and skips the test.
  await expect(
    page.getByTestId('gateway-payment-row').first().or(page.getByText(/Nothing to check/)),
  ).toBeVisible({ timeout: 30_000 });
}

test.describe('Admin gateway rescue — Mark as paid', () => {
  test.use({ storageState: ADMIN_STATE });

  test('happy: the unverified payment is listed with its basket, the dialog confirms it, and the booking shows as paid', async ({ page }) => {
    await openGatewayView(page);
    const row = page.getByTestId('gateway-payment-row').filter({ hasText: REF });
    test.skip((await row.count()) === 0, 'the seeded gateway booking is already confirmed (seed not reset)');
    await expect(row).toContainText('Basket JDWL-e2e-gateway-mark');
    await expect(row).toContainText('signature not verified');
    await expect(row).toContainText('Pending');

    await row.getByRole('button', { name: 'Mark as paid' }).click();
    const dialog = page.getByRole('dialog', { name: 'Mark as paid' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('mark-paid-amount')).toHaveText(/QAR 205/);
    const confirm = dialog.getByRole('button', { name: 'Confirm payment' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('PAY2M transaction ID').fill('E2E-TXN-GWAY-1');
    await dialog.getByLabel(/^Note/).fill('PAY2M dashboard shows the basket as paid (E2E)');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText(`Booking ${REF} confirmed`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('gateway-payment-row').filter({ hasText: REF })).toHaveCount(0, { timeout: 15_000 });

    // Back on the bookings list: the row is CONFIRMED and Paid, with the transaction id.
    await page.getByTestId('gateway-toggle').click();
    const search = page.getByPlaceholder('Search by ref or customer name...');
    await search.fill(REF);
    const bookingRow = page.locator('tbody tr').filter({ hasText: REF }).first();
    await expect(bookingRow).toBeVisible({ timeout: 15_000 });
    await expect(bookingRow).toContainText('CONFIRMED');
    await expect(bookingRow).toContainText('Paid');
    await bookingRow.click();
    await expect(page.getByText('TXN: E2E-TXN-GWAY-1')).toBeVisible();
    await expect(page.getByText(/Marked as paid by an admin on/)).toBeVisible();
  });

  test('a second confirmation of the same payment is refused', async ({ page }) => {
    // Independent of the test above: confirm (201, or 409 if already done),
    // then confirm again — the second call must always be 409.
    await page.goto('/admin/bookings', { waitUntil: 'domcontentloaded' });
    const res = await page.evaluate(async (ref) => {
      const list = await fetch(`/api/admin/bookings?search=${encodeURIComponent(ref)}&limit=5`, { credentials: 'include' });
      const data = await list.json();
      const booking = (data?.data ?? []).find((b: { ref: string }) => b.ref === ref);
      if (!booking?.payment?.id) return { first: -1, second: -1 };
      const post = async (txn: string) => {
        const r = await fetch(`/api/admin/payments/${booking.payment.id}/mark-paid`, {
          method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ transactionId: txn, note: 'second click (E2E)' }),
        });
        return r.status;
      };
      const first = await post('E2E-TXN-GWAY-2');
      const second = await post('E2E-TXN-GWAY-3');
      return { first, second };
    }, REF);
    test.skip(res.first === -1, 'the seeded gateway booking is missing');
    expect([201, 409]).toContain(res.first);
    expect(res.second).toBe(409);
  });
});
