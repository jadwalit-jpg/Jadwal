import { expect, request as playwrightRequest, type Page } from '@playwright/test';

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
  // The /login page sometimes shows a "You're in! Redirecting..." splash for
  // a few hundred ms before router.push kicks in — give it 25s rather than
  // 10s for slow dev servers.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 25000 });
  return true;
}

const API_BASE = process.env.E2E_API_URL || 'http://localhost:4000/api';

async function loginVendorWith(page: Page, cred: Cred): Promise<boolean> {
  // Drive the login through an isolated APIRequestContext so the Set-Cookie
  // from the cross-origin POST lands in a cookie jar we can read out and
  // inject into the page's BrowserContext. Doing this through the form would
  // need a SameSite-Strict-friendly redirect that the /login page doesn't
  // perform for VENDOR role, leaving page.context().storageState() empty.
  // Avoid baseURL: a path that starts with "/" replaces the path segment of
  // baseURL ("/api"), so "/auth/login" against baseURL "http://localhost:4000/api"
  // resolves to "http://localhost:4000/auth/login" (404). Use absolute URLs.
  const apiCtx = await playwrightRequest.newContext();
  try {
    const loginRes = await apiCtx
      .post(`${API_BASE}/auth/login`, { data: { email: cred.email, password: cred.password } })
      .catch(() => null);
    if (!loginRes || !loginRes.ok()) return false;

    const meRes = await apiCtx.get(`${API_BASE}/auth/me`).catch(() => null);
    if (!meRes || !meRes.ok()) return false;
    const body = (await meRes.json().catch(() => null)) as
      | { role?: string; vendor?: { slug?: string }; vendorSlug?: string }
      | null;
    if (!body || body.role !== 'VENDOR') return false;

    const state = await apiCtx.storageState();
    if (state.cookies.length === 0) return false;
    await page.context().addCookies(state.cookies);
  } finally {
    await apiCtx.dispose();
  }
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
  // Vendors authenticate via the same /login form as customers, but the
  // form only auto-redirects CUSTOMER role — for VENDOR we navigate manually
  // to /vendor/[slug]/dashboard after a successful API response.
  for (const cred of VENDOR_CANDIDATES) {
    if (await loginVendorWith(page, cred)) return cred;
  }
  throw new Error('Unable to authenticate vendor with known credentials');
}

/**
 * Read the vendor's slug after login by hitting GET /api/auth/me via the
 * authenticated browser context. Used by vendor specs to navigate to
 * /vendor/[slug]/* without hard-coding the slug.
 */
export async function vendorSlugFromMe(page: Page): Promise<string> {
  // Warm the browser context so storageState cookies are attached to
  // Playwright's APIRequestContext for the cross-origin call to :4000.
  if (page.url() === 'about:blank') {
    await page.goto('/').catch(() => undefined);
  }
  // Try /auth/me first — confirms the JWT is still valid AND returns the
  // real vendor slug. On failure we fall back to the seed slug; tests that
  // can't tolerate a stale auth state should pre-check via this helper and
  // skip when /auth/me is unauthenticated.
  const res = await page.request.get(`${API_BASE}/auth/me`).catch(() => null);
  if (res && res.ok()) {
    const body = (await res.json().catch(() => null)) as
      | { vendor?: { slug?: string }; vendorSlug?: string }
      | null;
    const slug = body?.vendor?.slug ?? body?.vendorSlug;
    if (slug) return slug;
  }
  return process.env.E2E_VENDOR_SLUG || 'e2e-vendor';
}

/**
 * Returns true when /auth/me succeeds for the current page's cookies.
 * Use this in vendor specs that would otherwise navigate to a vendor route
 * and get redirected to /register/vendor by RoleGuard.
 */
export async function isVendorAuthenticated(page: Page): Promise<boolean> {
  if (page.url() === 'about:blank') {
    await page.goto('/').catch(() => undefined);
  }
  const res = await page.request.get(`${API_BASE}/auth/me`).catch(() => null);
  if (!res || !res.ok()) return false;
  const body = (await res.json().catch(() => null)) as { role?: string } | null;
  return body?.role === 'VENDOR';
}
