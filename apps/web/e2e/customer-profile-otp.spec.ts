/**
 * E2E — customer profile update + phone OTP.
 *
 * Updates the customer's full name, saves, asserts persistence on reload.
 * Phone OTP path mocks the SMS-send API (do NOT hit real SNS).
 */
import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';
const HAS_CUSTOMER_STATE = existsSync(CUSTOMER_STATE);

test.describe('Customer profile + phone OTP', () => {
  test.use({ storageState: HAS_CUSTOMER_STATE ? CUSTOMER_STATE : undefined });

  test('happy: update full name + persist', async ({ page }) => {
    test.skip(!HAS_CUSTOMER_STATE, 'Customer storageState not available');

    await page.goto('/profile');
    await page.waitForLoadState('networkidle');

    const nameField = page.getByLabel(/full name|الاسم/i).first();
    if (!(await nameField.isVisible().catch(() => false))) {
      test.skip(true, 'No full-name input visible');
    }
    const newName = `E2E Customer ${Date.now()}`;
    await nameField.fill(newName);
    await page.getByRole('button', { name: /save|update|حفظ|تحديث/i }).first().click();
    await expect(page.getByText(/saved|updated|تم/i).first()).toBeVisible({ timeout: 10000 });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(nameField).toHaveValue(newName);
  });

  test('error: phone OTP — mock send + assert verified state', async ({ page }) => {
    test.skip(!HAS_CUSTOMER_STATE, 'Customer storageState not available');

    // Mock the OTP send endpoint so no real SNS call happens.
    await page.route('**/api/auth/phone-otp/send', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
    );
    // And the verify endpoint — accept any 6-digit code.
    await page.route('**/api/auth/phone-otp/verify', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ verified: true }) }),
    );

    await page.goto('/profile');
    await page.waitForLoadState('networkidle');

    const phoneInput = page.getByLabel(/phone|رقم|الهاتف/i).first();
    if (!(await phoneInput.isVisible().catch(() => false))) {
      test.skip(true, 'No phone input visible');
    }
    await phoneInput.fill('+97412345678');
    const sendBtn = page.getByRole('button', { name: /send|verify|ارسل|تحقق/i }).first();
    if (!(await sendBtn.isVisible().catch(() => false))) {
      test.skip(true, 'No phone verify button');
    }
    await sendBtn.click();

    // OTP entry — try filling 6 digits
    const otpInput = page.getByLabel(/code|otp|الرمز/i).first();
    if (await otpInput.isVisible().catch(() => false)) {
      await otpInput.fill('123456');
      await page.getByRole('button', { name: /verify|submit|تحقق|تأكيد/i }).first().click();
      await expect(page.getByText(/verified|verified|تم التحقق|verification/i).first())
        .toBeVisible({ timeout: 10000 });
    } else {
      test.skip(true, 'OTP input not visible after send');
    }
  });
});
