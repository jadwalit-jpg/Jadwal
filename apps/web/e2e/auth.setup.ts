import { test as setup } from '@playwright/test';
import { loginAsAdmin, loginAsCustomer } from './_fixtures/auth';

setup('authenticate admin', async ({ page }) => {
  await loginAsAdmin(page);
  await page.context().storageState({ path: 'e2e/.auth/admin.json' });
});

setup('authenticate customer', async ({ page }) => {
  try {
    await loginAsCustomer(page);
  } catch {
    setup.skip(true, 'Customer seed credentials unavailable; skipping customer auth setup');
  }
  await page.context().storageState({ path: 'e2e/.auth/customer.json' });
});
