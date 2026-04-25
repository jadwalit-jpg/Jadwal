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
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const TEST_EMAIL = 'customer@jadwal-test.local';
const TEST_PASSWORD = 'S3cure!Pass1';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed test customer in production');
  }

  const adapter = new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL }));
  const prisma = new PrismaClient({ adapter } as never);
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
    },
    update: {
      password: hash,
      role: 'CUSTOMER',
      emailVerified: true,
      lockedUntil: null,
      verificationToken: null,
      verificationTokenExpiry: null,
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
