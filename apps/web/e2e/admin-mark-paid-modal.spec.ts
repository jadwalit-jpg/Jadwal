/**
 * E2E — admin "Mark N as Paid" modal (§F1 of the post-Wave 5 audit).
 *
 * Wave 4's §M4 made `bankTransferRef` REQUIRED on POST /admin/payouts/mark-paid.
 * The frontend at `apps/web/src/app/admin/payouts/_components/payments-tab.tsx`
 * was retrofitted with a confirmation modal that captures the wire reference
 * before the mutation fires. This spec pins the user-facing contract:
 *
 *   1. Modal opens when "Mark N as Paid" is clicked
 *   2. Submit button is disabled while the ref is empty / < 3 chars
 *   3. Valid ref → POST hits /admin/payouts/mark-paid with the ref → toast
 *   4. Cancel / X / backdrop closes the modal WITHOUT firing the mutation
 *
 * All payment data is `page.route`-mocked so the spec is deterministic and
 * does not depend on the dev DB having a specific UNPAID payment seeded.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';

// ─── Mock fixtures ────────────────────────────────────────────────────────

const MOCK_PAYMENT_ID = '00000000-0000-4000-8000-00000000abcd';

const MOCK_PAYOUTS_RESPONSE = {
  data: [
    {
      id: MOCK_PAYMENT_ID,
      amount: '200.00',
      gatewayTxnId: 'TXN-MOCK-001',
      status: 'SUCCESS',
      payoutStatus: 'UNPAID',
      paidAt: new Date(Date.now() - 86400_000).toISOString(),
      method: 'PAY2M',
      createdAt: new Date(Date.now() - 86400_000).toISOString(),
      inflightRequest: null,
      booking: {
        ref: 'JDWL-MOCK-1',
        totalPrice: '200.00',
        serviceFee: '5.00',
        commissionAmount: '20.00',
        pointsRedeemed: null,
        pointsDiscount: null,
        couponDiscount: null,
        currencyCode: 'QAR',
        vendor: { id: 'vendor-mock', businessNameEn: 'Mock Tours' },
        customer: { fullName: 'Mock Customer' },
        activity: { titleEn: 'Mock Activity' },
      },
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
};

async function setupRoutes(page: Page) {
  // GET /admin/payouts — return our single UNPAID row.
  await page.route('**/api/admin/payouts**', async (route: Route) => {
    if (route.request().method() === 'GET' && !route.request().url().includes('/export')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PAYOUTS_RESPONSE),
      });
      return;
    }
    await route.fallback();
  });
}

// ─── Spec ─────────────────────────────────────────────────────────────────

test.describe('Admin payouts — Mark N as Paid modal (§F1)', () => {
  test.use({ storageState: ADMIN_STATE });

  test.beforeEach(async ({ page }) => {
    await setupRoutes(page);
    await page.goto('/admin/payouts');
    await page.waitForLoadState('networkidle');

    // Confirm the seeded row rendered (booking ref) — anchors the rest of
    // the test against an actually-painted DOM, not a still-spinning skel.
    await expect(page.getByText('JDWL-MOCK-1').first()).toBeVisible();
  });

  test('happy path: modal opens, validates ref, submits with ref, refetches', async ({ page }) => {
    // Select the actionable row via its row-level checkbox.
    const rowCheckbox = page.locator('tbody tr').filter({ hasText: 'JDWL-MOCK-1' })
      .getByRole('checkbox');
    await rowCheckbox.check();
    await expect(rowCheckbox).toBeChecked();

    // The "Mark 1 as Paid" button appears in the toolbar.
    const markButton = page.getByRole('button', { name: /mark 1 as paid/i });
    await expect(markButton).toBeVisible();
    await markButton.click();

    // Modal opens — locate the wire-reference label which is unique to
    // this modal (the revert modal uses entirely different copy).
    const refInput = page.getByPlaceholder(/SWIFT-MT103/i);
    await expect(refInput).toBeVisible({ timeout: 10000 });

    // Submit button starts disabled (empty input).
    const submit = page.getByRole('button', { name: /^mark as paid$/i });
    await expect(submit).toBeDisabled();

    // Below-min-length input keeps it disabled.
    await refInput.fill('AB');
    await expect(submit).toBeDisabled();

    // Valid ref enables the button. Mock the POST so it succeeds and we
    // can assert on the request payload + the success toast.
    let captured: { paymentIds?: string[]; bankTransferRef?: string } | null = null;
    await page.route('**/api/admin/payouts/mark-paid', async (route) => {
      captured = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updated: 1 }),
      });
    });

    await refInput.fill('SWIFT-MT103-XYZ-0099');
    await expect(submit).toBeEnabled();
    await Promise.all([
      page.waitForResponse((r) => /\/admin\/payouts\/mark-paid$/.test(r.url())),
      submit.click(),
    ]);

    expect(captured).not.toBeNull();
    expect(captured!.paymentIds).toEqual([MOCK_PAYMENT_ID]);
    expect(captured!.bankTransferRef).toBe('SWIFT-MT103-XYZ-0099');

    // Modal closes after success — input field disappears.
    await expect(refInput).not.toBeVisible();

    // Toast confirms the action.
    await expect(page.getByText(/payouts? marked as paid/i).first()).toBeVisible();
  });

  test('error path: Cancel closes modal WITHOUT firing the mutation', async ({ page }) => {
    // Track whether the mark-paid endpoint is hit. If Cancel works, this
    // counter must stay at zero for the duration of the test.
    let mutationCalls = 0;
    await page.route('**/api/admin/payouts/mark-paid', async (route) => {
      mutationCalls += 1;
      await route.fulfill({ status: 200, body: JSON.stringify({ updated: 0 }) });
    });

    const rowCheckbox = page.locator('tbody tr').filter({ hasText: 'JDWL-MOCK-1' })
      .getByRole('checkbox');
    await rowCheckbox.check();
    await page.getByRole('button', { name: /mark 1 as paid/i }).click();

    const refInput = page.getByPlaceholder(/SWIFT-MT103/i);
    await expect(refInput).toBeVisible({ timeout: 10000 });

    // Even if admin types a valid ref, Cancel must NOT submit it.
    await refInput.fill('SHOULD-NOT-SEND');
    await page.getByRole('button', { name: /^cancel$/i }).click();

    await expect(refInput).not.toBeVisible();
    expect(mutationCalls).toBe(0);
  });

  test('error path: backdrop click closes modal without firing mutation', async ({ page }) => {
    let mutationCalls = 0;
    await page.route('**/api/admin/payouts/mark-paid', async (route) => {
      mutationCalls += 1;
      await route.fulfill({ status: 200, body: JSON.stringify({ updated: 0 }) });
    });

    const rowCheckbox = page.locator('tbody tr').filter({ hasText: 'JDWL-MOCK-1' })
      .getByRole('checkbox');
    await rowCheckbox.check();
    await page.getByRole('button', { name: /mark 1 as paid/i }).click();

    const refInput = page.getByPlaceholder(/SWIFT-MT103/i);
    await expect(refInput).toBeVisible({ timeout: 10000 });

    // Click the backdrop — the outer div with `fixed inset-0` is the
    // close-on-outside-click target the modal renders. Click near top-left
    // of the viewport to land on the backdrop, not the centred modal card.
    const backdrop = page.locator('div.fixed.inset-0.z-50').first();
    await backdrop.click({ position: { x: 10, y: 10 } });

    await expect(refInput).not.toBeVisible();
    expect(mutationCalls).toBe(0);
  });
});
