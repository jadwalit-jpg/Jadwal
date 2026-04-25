import { expect, type Page } from '@playwright/test';

type Cred = { email: string; password: string };

function uniqueCreds(creds: Cred[]): Cred[] {
  const seen = new Set<string>();
  return creds.filter((c) => {
    const key = `${c.email}|${c.password}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function envCred(prefix: 'ADMIN' | 'CUSTOMER' | 'VENDOR'): Cred[] {
  const email = process.env[`${prefix}_E2E_EMAIL`] || process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_E2E_PASSWORD`] || process.env[`${prefix}_PASSWORD`];
  if (!email || !password) return [];
  return [{ email, password }];
}

async function submitLogin(page: Page, email: string, password: string) {
  await page.getByLabel(/email|البريد/i).fill(email);
  await page.getByLabel(/password|كلمة المرور/i).fill(password);
  await page.getByRole('button', { name: /^(log in|sign in|تسجيل الدخول)$/i }).click();
}

async function loginCustomerWith(page: Page, cred: Cred): Promise<boolean> {
  await page.goto('/login');
  await submitLogin(page, cred.email, cred.password);
  const loginError = await page
    .locator('.bg-red-500\\/10')
    .first()
    .isVisible()
    .catch(() => false);
  if (loginError) return false;
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
  return true;
}

async function loginAdminWith(page: Page, cred: Cred): Promise<boolean> {
  await page.goto('/admin/login');
  await submitLogin(page, cred.email, cred.password);
  const loginError = await page
    .locator('.bg-red-500\\/10')
    .first()
    .isVisible()
    .catch(() => false);
  if (loginError) return false;
  await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 10000 });
  return true;
}

const ADMIN_CANDIDATES = uniqueCreds([
  ...envCred('ADMIN'),
  { email: 'admin@jadwal.com', password: 'Admin123!' },
  { email: 'admin@jadwal.com', password: 'admin123Password' },
]);

const CUSTOMER_CANDIDATES = uniqueCreds([
  ...envCred('CUSTOMER'),
  { email: 'customer@jadwal-test.local', password: 'S3cure!Pass1' },
  { email: 'customer@jadwal.com', password: 'Customer123!' },
  { email: 'customer@jadwal.com', password: 'Admin123!' },
]);

const VENDOR_CANDIDATES = uniqueCreds([
  ...envCred('VENDOR'),
  { email: 'vendor@jadwal-test.local', password: 'S3cure!Pass1' },
  { email: 'vendor@jadwal.com', password: 'Vendor123!' },
  { email: 'vendor@jadwal.com', password: 'Admin123!' },
]);

export async function loginAsAdmin(page: Page): Promise<Cred> {
  for (const cred of ADMIN_CANDIDATES) {
    if (await loginAdminWith(page, cred)) return cred;
  }
  throw new Error('Unable to authenticate admin with known credentials');
}

export async function loginAsCustomer(page: Page): Promise<Cred> {
  for (const cred of CUSTOMER_CANDIDATES) {
    if (await loginCustomerWith(page, cred)) return cred;
  }
  throw new Error('Unable to authenticate customer with known credentials');
}

export async function loginAsVendor(page: Page): Promise<Cred> {
  // Vendors authenticate via the same /login form as customers — server
  // resolves their role and redirects to /vendor/[slug]/dashboard.
  for (const cred of VENDOR_CANDIDATES) {
    if (await loginCustomerWith(page, cred)) return cred;
  }
  throw new Error('Unable to authenticate vendor with known credentials');
}

/**
 * Read the vendor's slug after login by hitting GET /api/auth/me via the
 * authenticated browser context. Used by vendor specs to navigate to
 * /vendor/[slug]/* without hard-coding the slug.
 */
export async function vendorSlugFromMe(page: Page): Promise<string> {
  const res = await page.request.get('/api/auth/me');
  if (!res.ok()) throw new Error('Could not read /api/auth/me to resolve vendor slug');
  const body = (await res.json()) as { vendor?: { slug?: string }; vendorSlug?: string };
  const slug = body.vendor?.slug ?? body.vendorSlug;
  if (!slug) throw new Error('No vendor slug in /api/auth/me response — is the user actually a VENDOR?');
  return slug;
}
