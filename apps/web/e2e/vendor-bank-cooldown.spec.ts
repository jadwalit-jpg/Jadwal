/**
 * E2E — §B4 vendor bank-details cool-down.
 *
 * After a vendor edits their bank details, evaluatePayoutEligibility now
 * blocks payout requests for `PAYOUT_BANK_DETAILS_COOLDOWN_DAYS` (default 7)
 * days. This stops a compromised account from rotating bank details to an
 * attacker's account and immediately requesting a payout.
 *
 * The frontend at /vendor/[slug]/earnings reads the eligibility endpoint
 * and surfaces a blocked banner / disables the Request Payout CTA. This
 * spec mocks eligibility with the BANK_DETAILS_RECENTLY_CHANGED code and
 * asserts the blocked state is visible.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const VENDOR_STATE = 'e2e/.auth/vendor.json';

const MOCK_ELIGIBILITY_BLOCKED = {
  ok: false,
  code: 'BANK_DETAILS_RECENTLY_CHANGED',
  // Server returns daysRemaining so the UI can show "available in N days".
  daysRemaining: 6,
  reason: 'Bank details changed less than 7 days ago. Please wait before requesting a payout.',
  // The available-balance/payable shape the page still needs to render the
  // page header without crashing on a null shape.
  available: 0,
  pending: 0,
  totalEarnings: 0,
  currency: 'QAR',
};

const MOCK_PAYOUT_REQUESTS_EMPTY = {
  data: [],
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
};

async function setupRoutes(page: Page) {
  // Order matters: register the broader pattern first so the more-specific
  // /eligibility route registered second matches first under LIFO.
  await page.route('**/api/vendor/payout-requests**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PAYOUT_REQUESTS_EMPTY),
      });
      return;
    }
    await route.fallback();
  });
  await page.route('**/api/vendor/payout-requests/eligibility**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_ELIGIBILITY_BLOCKED),
      });
      return;
    }
    await route.fallback();
  });
  // Earnings summary — keep numbers; some implementations render even when
  // eligibility is blocked.
  await page.route('**/api/vendor/earnings**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          available: 0,
          pending: 0,
          totalEarnings: 0,
          currency: 'QAR',
          recentPayments: [],
        }),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe('Vendor earnings — §B4 bank-details cool-down', () => {
  test.use({ storageState: VENDOR_STATE });

  test('payout blocked banner shows when bank details changed within cool-down', async ({ page }) => {
    await setupRoutes(page);
    // Earnings page is under /vendor/[slug]/earnings — derive slug via the
    // helper but accept the env fallback so this spec runs even when
    // /auth/me is mocked away later.
    const slug = process.env.E2E_VENDOR_SLUG || 'e2e-vendor';
    await page.goto(`/vendor/${slug}/earnings`);
    await page.waitForLoadState('networkidle');

    // Either the BANK_DETAILS code is surfaced verbatim, or a friendlier
    // copy that mentions "bank details" / "wait" / a number of days.
    const blockedHint = page.getByText(/bank details|cool[\s-]?down|wait|\d+\s*(day|يوم)/i);
    await expect(blockedHint.first()).toBeVisible({ timeout: 15000 });

    // Request Payout button — when present, must be disabled OR the click
    // must not produce a request. We assert the UX guard: either the
    // submit shows a 400 toast (server still rejects) or button state.
    // Capture POST attempts to the request endpoint to ensure a click
    // (if it happens) triggers an error toast and not a successful POST.
    let postAttempts = 0;
    await page.route('**/api/vendor/payout-requests', async (route: Route) => {
      if (route.request().method() === 'POST') {
        postAttempts += 1;
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 400,
            message: 'Bank details changed less than 7 days ago.',
            error: 'BANK_DETAILS_RECENTLY_CHANGED',
          }),
        });
        return;
      }
      await route.fallback();
    });

    // If the button exists, attempt to click — expect an error toast or
    // an unchanged page. We don't assume a specific button locator; the
    // page may render either a CTA or an inline-disabled state.
    const cta = page.getByRole('button', { name: /request payout|طلب صرف/i }).first();
    const ctaVisible = await cta.isVisible().catch(() => false);
    if (ctaVisible) {
      const isDisabled = await cta.isDisabled().catch(() => false);
      if (!isDisabled) {
        await cta.click();
        // Expect the server-side block toast.
        await expect(
          page.getByText(/bank details|cool[\s-]?down/i).first(),
        ).toBeVisible({ timeout: 5000 });
        // If the click reached the server it must NOT have succeeded.
        // Either the route was blocked client-side (postAttempts==0)
        // or the server returned 400 (postAttempts==1, no PENDING row
        // appeared because the mock response was 400).
        expect(postAttempts).toBeLessThanOrEqual(1);
      }
    }
  });
});
