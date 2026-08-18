import { readFileSync, writeFileSync } from 'node:fs';
import { test as setup } from '@playwright/test';
import { loginAsAdmin, loginAsCustomer, loginAsVendor } from './_fixtures/auth';

// The app origin storageState localStorage entries are scoped to. Must match the
// page origin (scheme+host+port) exactly or the seeded value is ignored.
const APP_ORIGIN = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const CONSENT_KEY = 'jadwal_cookie_consent';

/**
 * Seed the cookie-consent decision into a saved storageState so the fixed
 * bottom-of-page consent banner (role="dialog" aria-label="Cookies",
 * `fixed bottom-4 … z-[200]`, shipped with the Meta Pixel) NEVER renders during
 * tests. When it renders it overlays the bottom of every page and intercepts
 * pointer events on any button there (coupon "Create Coupon", "Proceed to
 * payment", "Submit for approval", …) → the click retries until the 60s test
 * timeout. `declined` also stops the pixel from loading, keeping CI hermetic.
 */
function injectCookieConsent(path: string) {
  const state = JSON.parse(readFileSync(path, 'utf8')) as {
    cookies: unknown[];
    origins?: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
  };
  state.origins = state.origins ?? [];
  let origin = state.origins.find((o) => o.origin === APP_ORIGIN);
  if (!origin) {
    origin = { origin: APP_ORIGIN, localStorage: [] };
    state.origins.push(origin);
  }
  origin.localStorage = origin.localStorage.filter((e) => e.name !== CONSENT_KEY);
  origin.localStorage.push({ name: CONSENT_KEY, value: 'declined' });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

/**
 * The API's access-token cookie expires after JWT_EXPIRATION seconds (default
 * 900s = 15 min). A full chromium suite + the slow tests in it can outrun that
 * window, after which Chromium drops the cookie and the middleware redirects
 * specs out of the protected area. Patch the saved storageState to keep the
 * cookies alive in the browser; the API still validates the JWT, and the axios
 * 401 interceptor will hit /auth/refresh and re-issue a fresh token on demand.
 */
function extendCookieExpiry(path: string) {
  const farFuture = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // +7 days
  const state = JSON.parse(readFileSync(path, 'utf8')) as {
    cookies: Array<{ expires?: number }>;
  };
  for (const c of state.cookies) {
    if (typeof c.expires === 'number' && c.expires > 0 && c.expires < farFuture) {
      c.expires = farFuture;
    }
  }
  writeFileSync(path, JSON.stringify(state, null, 2));
}

setup('authenticate admin', async ({ page }) => {
  await loginAsAdmin(page);
  await page.context().storageState({ path: 'e2e/.auth/admin.json' });
  extendCookieExpiry('e2e/.auth/admin.json');
  injectCookieConsent('e2e/.auth/admin.json');
});

setup('authenticate customer', async ({ page }) => {
  try {
    await loginAsCustomer(page);
  } catch {
    setup.skip(true, 'Customer seed credentials unavailable; skipping customer auth setup');
  }
  await page.context().storageState({ path: 'e2e/.auth/customer.json' });
  extendCookieExpiry('e2e/.auth/customer.json');
  injectCookieConsent('e2e/.auth/customer.json');
});

setup('authenticate vendor', async ({ page }) => {
  try {
    await loginAsVendor(page);
  } catch (err) {
    setup.skip(true, `Vendor seed credentials unavailable; skipping vendor auth setup (${(err as Error).message})`);
  }
  await page.context().storageState({ path: 'e2e/.auth/vendor.json' });
  extendCookieExpiry('e2e/.auth/vendor.json');
  injectCookieConsent('e2e/.auth/vendor.json');
});

// Anonymous storageState: no auth cookies, just the seeded cookie-consent so the
// bottom banner never intercepts clicks. Used as the DEFAULT storageState for the
// browser projects (playwright.config.ts) so specs that don't log in (signup,
// password-reset, catalog browse, …) are still banner-free.
setup('seed anonymous consent state', async () => {
  const state = {
    cookies: [],
    origins: [{ origin: APP_ORIGIN, localStorage: [{ name: CONSENT_KEY, value: 'declined' }] }],
  };
  writeFileSync('e2e/.auth/anon.json', JSON.stringify(state, null, 2));
});
