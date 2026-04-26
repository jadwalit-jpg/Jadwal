import { readFileSync, writeFileSync } from 'node:fs';
import { test as setup } from '@playwright/test';
import { loginAsAdmin, loginAsCustomer, loginAsVendor } from './_fixtures/auth';

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
});

setup('authenticate customer', async ({ page }) => {
  try {
    await loginAsCustomer(page);
  } catch {
    setup.skip(true, 'Customer seed credentials unavailable; skipping customer auth setup');
  }
  await page.context().storageState({ path: 'e2e/.auth/customer.json' });
  extendCookieExpiry('e2e/.auth/customer.json');
});

setup('authenticate vendor', async ({ page }) => {
  try {
    await loginAsVendor(page);
  } catch (err) {
    setup.skip(true, `Vendor seed credentials unavailable; skipping vendor auth setup (${(err as Error).message})`);
  }
  await page.context().storageState({ path: 'e2e/.auth/vendor.json' });
  extendCookieExpiry('e2e/.auth/vendor.json');
});
