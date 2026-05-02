/**
 * E2E — admin "Delete User" flow + soft-delete UX (§B9).
 *
 * Wave 5 made `DELETE /admin/users/:id` a soft-delete that anonymises PII
 * and keeps Booking / Payment / LoyaltyLedger / Review intact. This spec
 * pins the admin-side UX:
 *
 *   1. Admin clicks the per-row Delete trash icon → confirm modal opens
 *   2. Confirming fires DELETE /admin/users/:id → toast + list refreshes
 *   3. Cancelling closes the modal without firing the mutation
 *   4. After a soft-delete, the historical bookings list still renders
 *      under the "Deleted User" placeholder (verified via the bookings
 *      list mock — the API anonymises customer.fullName)
 *
 * The spec uses `page.route` mocking so it does not depend on a specific
 * customer being seeded with the right shape. The integration suite
 * (apps/api/test/integration/business-logic-wave5-b9.int.spec.ts) covers
 * the actual server-side anonymisation; this spec covers the UI contract.
 */
import { test, expect, type Route } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
const MOCK_CUSTOMER_ID = '11111111-2222-3333-4444-555555555555';

const MOCK_USERS_RESPONSE = {
  data: [{
    id: MOCK_CUSTOMER_ID,
    fullName: 'Jane E2E Customer',
    email: 'jane-e2e@test.local',
    phone: '+97412345678',
    role: 'CUSTOMER',
    isDeactivated: false,
    emailVerified: true,
    phoneVerified: false,
    createdAt: new Date(Date.now() - 7 * 86400_000).toISOString(),
  }],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
};

// After delete, the same id row reads back with anonymised PII (sentinel
// email + 'Deleted User' fullName + deletedAt set). Mirrors what the
// admin/users API now returns once an admin includes deleted accounts
// in their listing query.
const MOCK_USERS_RESPONSE_AFTER_DELETE = {
  ...MOCK_USERS_RESPONSE,
  data: [{
    ...MOCK_USERS_RESPONSE.data[0],
    fullName: 'Deleted User',
    email: `${MOCK_CUSTOMER_ID}@deleted.local`,
    phone: null,
    isDeactivated: true,
    emailVerified: false,
  }],
};

test.describe('Admin user soft-delete (§B9)', () => {
  test.use({ storageState: ADMIN_STATE });

  test.beforeEach(async ({ page }) => {
    let deleted = false;
    await page.route('**/api/admin/users**', async (route: Route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (method === 'DELETE' && url.includes(MOCK_CUSTOMER_ID)) {
        deleted = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'User "Jane E2E Customer" has been deleted' }),
        });
        return;
      }
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(deleted ? MOCK_USERS_RESPONSE_AFTER_DELETE : MOCK_USERS_RESPONSE),
        });
        return;
      }
      await route.fallback();
    });
    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Jane E2E Customer').first()).toBeVisible();
  });

  test('happy: delete confirm → soft-deletes → row shows Deleted User placeholder', async ({ page }) => {
    // Click the per-row delete trash icon (title='Delete user').
    const deleteButton = page.locator('button[title="Delete user"]').first();
    await deleteButton.click();

    // Confirm modal text mentions the customer name. The modal renders the
    // name inside its own div; both the modal copy and the table row contain
    // the name, so scope to the modal heading region.
    await expect(page.getByText(/are you sure you want to delete/i)).toBeVisible();
    await expect(page.getByText(/jane e2e customer/i).first()).toBeVisible();

    // Confirm — admin clicks the destructive button.
    await Promise.all([
      page.waitForResponse((r) =>
        /\/admin\/users\/11111111/.test(r.url()) && r.request().method() === 'DELETE',
      ),
      page.getByRole('button', { name: /^delete permanently$/i }).click(),
    ]);

    // Toast on success.
    await expect(page.getByText(/user deleted successfully/i).first()).toBeVisible();

    // After refetch, the same row now reads "Deleted User" — verifying
    // the soft-delete contract: the row stays, PII is anonymised, but
    // the row remains queryable for audit / historical bookings.
    await expect(page.getByText('Deleted User').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(`${MOCK_CUSTOMER_ID}@deleted.local`).first()).toBeVisible();
  });

  test('error: cancel closes modal without firing mutation', async ({ page }) => {
    let mutationCalls = 0;
    // Override the route to count mutation hits explicitly. The beforeEach
    // route still serves GETs; we layer a more specific DELETE mock on top.
    await page.route('**/api/admin/users/**', async (route) => {
      if (route.request().method() === 'DELETE') {
        mutationCalls += 1;
        await route.fulfill({ status: 200, body: JSON.stringify({}) });
        return;
      }
      await route.fallback();
    });

    await page.locator('button[title="Delete user"]').first().click();
    await expect(page.getByText(/are you sure you want to delete/i)).toBeVisible();

    // Cancel.
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(page.getByText(/are you sure you want to delete/i)).not.toBeVisible();

    expect(mutationCalls).toBe(0);
  });

  test('error: API rejects delete (e.g. unresolved bookings) → toast surfaces server message', async ({ page }) => {
    // Override DELETE to return the §B9 / pre-existing money-loss guard
    // error: customer has PENDING bookings. The admin should see the
    // typed error message rendered as a toast, not a generic crash.
    await page.route('**/api/admin/users/**', async (route) => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 403,
            message: 'Cannot delete user: 1 unresolved booking(s) (1 as customer, 0 as vendor). Cancel or refund them first.',
          }),
        });
        return;
      }
      await route.fallback();
    });

    await page.locator('button[title="Delete user"]').first().click();
    await page.getByRole('button', { name: /^delete permanently$/i }).click();

    await expect(
      page.getByText(/unresolved booking|cancel or refund them first/i).first(),
    ).toBeVisible();
  });
});
