/**
 * Seeds the E2E customer user expected by the Playwright auth fixture
 * (apps/web/e2e/_fixtures/auth.ts → loginAsCustomer).
 *
 * Idempotent — running twice is safe; the upsert resets the password,
 * verification state, and lockout so the user is always ready for tests.
 *
 * Usage (inside the api docker container):
 *   docker compose exec -T api npx tsx prisma/seed-e2e-customer.ts
 *
 * NOT FOR PRODUCTION. The credentials are hard-coded test fixtures.
 */
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { createSeedPrisma } from './_db-helper';
import { TERMS_VERSION } from '../src/common/terms';

dotenv.config({ path: path.join(__dirname, '../.env') });

const TEST_EMAIL = 'customer@jadwal-test.local';
const TEST_PASSWORD = 'S3cure!Pass1';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed test customer in production');
  }

  const prisma = createSeedPrisma();
  const hash = await bcrypt.hash(TEST_PASSWORD, 12);

  const user = await prisma.user.upsert({
    where: { email: TEST_EMAIL },
    create: {
      email: TEST_EMAIL,
      fullName: 'E2E Test Customer',
      password: hash,
      role: 'CUSTOMER',
      emailVerified: true,
      lockedUntil: null,
      // Established test user has accepted the current Terms — otherwise the
      // soft terms-consent banner (fixed bottom-4 end-4, terms-consent-gate.tsx)
      // renders on every page and intercepts clicks on bottom-corner buttons
      // (proceed-to-payment, etc.). Its dismiss flag lives in sessionStorage,
      // which Playwright storageState can't seed — so accept at the data level.
      termsAcceptedAt: new Date(),
      termsAcceptedVersion: TERMS_VERSION,
    },
    update: {
      password: hash,
      role: 'CUSTOMER',
      emailVerified: true,
      lockedUntil: null,
      verificationToken: null,
      verificationTokenExpiry: null,
      termsAcceptedAt: new Date(),
      termsAcceptedVersion: TERMS_VERSION,
    },
  });

  console.log('E2E test customer ready:');
  console.log('  email:    ' + user.email);
  console.log('  password: ' + TEST_PASSWORD + '   (test fixture only)');
  console.log('  verified: ' + user.emailVerified);
  console.log('  role:     ' + user.role);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
