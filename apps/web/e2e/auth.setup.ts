import { test as setup } from '@playwright/test';
import { loginAsAdmin, loginAsCustomer, loginAsVendor } from './_fixtures/auth';

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

setup('authenticate vendor', async ({ page }) => {
  try {
    await loginAsVendor(page);
  } catch {
    setup.skip(true, 'Vendor seed credentials unavailable; run `docker compose exec -T api npx tsx prisma/seed-e2e-vendor.ts` first');
  }
  await page.context().storageState({ path: 'e2e/.auth/vendor.json' });
});
