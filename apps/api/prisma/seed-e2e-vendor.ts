/**
 * Seeds the E2E vendor user + Vendor row expected by the Playwright auth
 * fixture (apps/web/e2e/_fixtures/auth.ts → loginAsVendor) and the vendor
 * specs (vendor-login-dashboard.spec.ts and friends).
 *
 * Idempotent — running twice is safe; the upserts reset password,
 * verification state, lockout, and pin the Vendor row to status=ACTIVE so
 * tests can hit the dashboard immediately.
 *
 * Usage (inside the api docker container):
 *   docker compose exec -T api npx tsx prisma/seed-e2e-vendor.ts
 *
 * NOT FOR PRODUCTION. Credentials are hard-coded test fixtures.
 */
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { createSeedPrisma } from './_db-helper';

dotenv.config({ path: path.join(__dirname, '../.env') });

const TEST_EMAIL = 'vendor@jadwal-test.local';
const TEST_PASSWORD = 'S3cure!Pass1';
const TEST_VENDOR_SLUG = 'e2e-vendor';
const TEST_BUSINESS_ID = 'E2E-BIZ-0001';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed test vendor in production');
  }

  const prisma = createSeedPrisma();
  const hash = await bcrypt.hash(TEST_PASSWORD, 12);

  // Vendor.country is a required relation (Restrict on delete) — pick the
  // first existing Country row. If none exists the test environment isn't
  // bootstrapped yet; fail loudly with a clear message rather than guessing.
  const country = await prisma.country.findFirst();
  if (!country) {
    throw new Error(
      'No Country row found in DB — seed at least one country first (e.g. via Prisma Studio or a fixture seed) before running this script.',
    );
  }

  const user = await prisma.user.upsert({
    where: { email: TEST_EMAIL },
    create: {
      email: TEST_EMAIL,
      fullName: 'E2E Test Vendor',
      password: hash,
      role: 'VENDOR',
      emailVerified: true,
      lockedUntil: null,
    },
    update: {
      password: hash,
      role: 'VENDOR',
      emailVerified: true,
      lockedUntil: null,
      verificationToken: null,
      verificationTokenExpiry: null,
    },
  });

  const vendor = await prisma.vendor.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      businessNameEn: 'E2E Test Vendor',
      businessNameAr: 'بائع تجريبي',
      businessId: TEST_BUSINESS_ID,
      slug: TEST_VENDOR_SLUG,
      descriptionEn: 'Vendor account used by Playwright E2E specs.',
      descriptionAr: 'حساب بائع للاختبار.',
      phone: '+97400000000',
      countryId: country.id,
      status: 'ACTIVE',
    },
    update: {
      businessNameEn: 'E2E Test Vendor',
      businessNameAr: 'بائع تجريبي',
      slug: TEST_VENDOR_SLUG,
      countryId: country.id,
      status: 'ACTIVE',
    },
  });

  console.log('E2E test vendor ready:');
  console.log('  email:    ' + user.email);
  console.log('  password: ' + TEST_PASSWORD + '   (test fixture only)');
  console.log('  slug:     ' + vendor.slug);
  console.log('  status:   ' + vendor.status);
  console.log('  country:  ' + country.id);
  console.log('');
  console.log('Login at /login or directly /vendor/' + vendor.slug + '/dashboard');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
