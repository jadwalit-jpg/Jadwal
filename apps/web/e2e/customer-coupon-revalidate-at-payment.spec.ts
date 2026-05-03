/**
 * E2E — §B1 customer coupon revalidation at payment time.
 *
 * Wave 1 added a re-check in payment.service.handleCallback that drops the
 * frozen `couponDiscount` if the coupon expired (or hit usage cap) between
 * booking creation and payment confirmation. Customers must NOT see a
 * stale discount applied on a booking that confirmed after the coupon
 * expired — the receipt has to show the full re-priced total.
 *
 * Mock strategy: stand up two booking states. First GET (post-pay landing)
 * returns the booking with couponCode set but couponDiscount=0 and
 * totalPrice = activity.price × guests (the re-priced total). The spec
 * then asserts the visible price matches the un-discounted amount.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';

const MOCK_BOOKING_ID = '00000000-0000-4000-8000-0000000010b1';
const ACTIVITY_PRICE = 250.00;
const GUESTS = 2;
const FULL_TOTAL = ACTIVITY_PRICE * GUESTS; // 500.00

const MOCK_BOOKING_RESPONSE = {
  id: MOCK_BOOKING_ID,
  ref: 'JDWL-B1-0001',
  status: 'CONFIRMED',
  startDatetime: new Date(Date.now() + 86400_000).toISOString(),
  endDatetime: new Date(Date.now() + 86400_000 + 3600_000).toISOString(),
  guests: GUESTS,
  totalPrice: FULL_TOTAL.toFixed(2),
  serviceFee: '0.00',
  commissionAmount: '50.00',
  // §B1 — revalidation re-priced this booking. couponCode is preserved
  // for forensic trace ("customer attempted COUPON-EXPIRED at payment time")
  // but couponDiscount must be zero so receipts show the actual cash paid.
  couponCode: 'EXPIRED-50',
  couponDiscount: '0.00',
  pointsRedeemed: 0,
  pointsDiscount: '0.00',
  currencyCode: 'QAR',
  activity: {
    id: 'act-mock',
    titleEn: 'Mock Coupon-Expired Activity',
    titleAr: 'نشاط تجريبي',
    slug: 'mock-coupon-expired',
    pricePerPerson: ACTIVITY_PRICE.toFixed(2),
  },
  payment: {
    id: 'pay-mock',
    amount: FULL_TOTAL.toFixed(2),
    status: 'SUCCESS',
    method: 'PAY2M',
  },
};

async function setupRoutes(page: Page) {
  await page.route('**/api/bookings/**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_BOOKING_RESPONSE),
      });
      return;
    }
    await route.fallback();
  });
  // Some pages also fan out to /my-bookings — keep a stub so the network
  // doesn't reach the dev API and return real, unrelated bookings.
  await page.route('**/api/my-bookings**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [MOCK_BOOKING_RESPONSE], total: 1, page: 1, totalPages: 1 }),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe('Customer payment confirmation — §B1 coupon revalidation', () => {
  test.use({ storageState: CUSTOMER_STATE });

  test('confirmed booking shows full price, no discount line item', async ({ page }) => {
    await setupRoutes(page);
    await page.goto(`/bookings/${MOCK_BOOKING_ID}`);
    await page.waitForLoadState('networkidle');

    // Confirmation banner / status renders.
    await expect(page.getByText(/confirmed|مؤكد/i).first()).toBeVisible({ timeout: 15000 });

    // The receipt must show 500.00 QAR — the re-priced total. Searching for
    // the formatted number tolerates either "500.00 QAR", "500 QAR" or
    // "QAR 500" depending on locale rendering.
    await expect(page.getByText(/500/).first()).toBeVisible();

    // The discount line MUST NOT show a non-zero deduction. The page
    // typically renders "Coupon" / "خصم" / "Discount" alongside the value;
    // assert that we don't render a row with a positive discount currency.
    const negativeDiscount = page.locator('body').getByText(/-\s*\d+\.?\d*\s*(QAR|ر\.ق)/i);
    await expect(negativeDiscount).toHaveCount(0);
  });
});
