/**
 * Integration-test harness.
 *
 * Connects to a real Postgres (`jadwal_test` database) + real Redis via the
 * already-running docker-compose services. PAY2M stays mocked.
 *
 * Usage in a spec:
 *   const ctx = getTestContext();
 *   beforeAll(async () => { await ctx.start(); });
 *   beforeEach(async () => { await ctx.reset(); });
 *   afterAll(async () => { await ctx.stop(); });
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import Redis from 'ioredis';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:admin123@localhost:5433/jadwal_test?schema=public';

const TEST_REDIS_URL =
  process.env.TEST_REDIS_URL ||
  'redis://localhost:6379/15'; // isolated DB 15 for integration

// List of tables to truncate between tests, in FK-safe order (children first).
// CASCADE fallback makes order mostly moot but we keep it explicit.
// Actual Postgres table names (mapped via @@map in schema.prisma).
// CASCADE makes order mostly moot but we still list children first for clarity.
const TRUNCATE_TABLES_ORDER = [
  'loyalty_ledger',
  'claimed_coupons',
  'likes',
  'reviews',
  'notifications',
  'push_subscriptions',
  'email_outbox',
  'audit_logs',
  'reconciliation_logs',
  'security_logs',
  'refresh_tokens',
  'payout_requests',
  'payments',
  'bookings',
  'coupons',
  'trending_events',
  'activities',
  'vendors',     // Vendor has userId FK → truncate vendors before users
  'users',
  'cities',
  'categories',
  'countries',
  'loyalty_config',
  'platform_settings',
] as const;

interface TestContext {
  prisma: PrismaClient;
  redis: Redis;
  start: () => Promise<void>;
  reset: () => Promise<void>;
  stop: () => Promise<void>;
}

let _singleton: TestContext | null = null;

export function getTestContext(): TestContext {
  if (_singleton) return _singleton;

  // Match production PrismaService: use @prisma/adapter-pg with its own Pool
  // so behaviour (timeouts, connection reuse) matches what the app sees.
  const pool = new Pool({
    connectionString: TEST_DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as any);

  const redis = new Redis(TEST_REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  _singleton = {
    prisma,
    redis,
    async start() {
      await prisma.$connect();
      if (redis.status !== 'ready') await redis.connect();
    },
    async reset() {
      // Truncate every table with CASCADE and RESTART IDENTITY. Much faster
      // than running DELETE + a migration reset per test; leaves schema intact.
      const list = TRUNCATE_TABLES_ORDER.map(t => `"${t}"`).join(', ');
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`,
      );
      // Flush the isolated Redis DB we claimed (DB 15).
      await redis.flushdb();
    },
    async stop() {
      await prisma.$disconnect();
      await pool.end();
      redis.disconnect();
    },
  };

  return _singleton;
}

/**
 * Minimal reference-data seed used by most suites. Creates:
 *   - Country QA (ACTIVE)
 *   - City Doha
 *   - Category Adventure
 *   - Vendor user (CUSTOMER role) with approved Vendor profile
 *   - One HOURLY Activity (capacity 10, duration 2h, 09:00-21:00)
 *   - One CUSTOMER user
 *
 * Returns the IDs for tests to reference.
 */
export async function seedReference(prisma: PrismaClient) {
  const country = await prisma.country.create({
    data: {
      nameEn: 'Qatar', nameAr: 'قطر', isoCode: 'QA',
      currencyCode: 'QAR', defaultTimezone: 'Asia/Qatar',
      serviceFeeFixed: 5, status: 'ACTIVE',
    },
  });
  const city = await prisma.city.create({
    data: {
      countryId: country.id, nameEn: 'Doha', nameAr: 'الدوحة',
      lat: 25.28, lng: 51.53,
    },
  });
  const category = await prisma.category.create({
    data: { nameEn: 'Adventure', nameAr: 'مغامرة', slug: 'adventure' },
  });

  // Vendor's underlying User
  const vendorUser = await prisma.user.create({
    data: {
      fullName: 'Test Vendor', email: 'vendor@test.com',
      password: '$2b$10$dummy.hash.for.tests.never.used.in.auth',
      role: 'VENDOR', emailVerified: true,
    },
  });
  const vendor = await prisma.vendor.create({
    data: {
      userId: vendorUser.id, businessNameEn: 'Test Biz', businessNameAr: 'تست',
      businessId: 'BIZ-TEST-1', slug: 'test-biz',
      countryId: country.id, status: 'ACTIVE',
    },
  });

  // Customer user
  const customer = await prisma.user.create({
    data: {
      fullName: 'Test Customer', email: 'customer@test.com',
      password: '$2b$10$dummy.hash.for.tests.never.used.in.auth',
      role: 'CUSTOMER', emailVerified: true,
    },
  });

  // Hourly activity — capacity 10 seats, duration 2h, open 09:00-21:00
  const activity = await prisma.activity.create({
    data: {
      vendorId: vendor.id, categoryId: category.id, countryId: country.id, cityId: city.id,
      titleEn: 'Sample Tour', titleAr: 'جولة',
      slug: 'sample-tour-' + Math.random().toString(36).slice(2, 8),
      descriptionEn: 'desc', descriptionAr: 'وصف',
      locationAddress: 'Doha Corniche',
      locationLat: 25.28, locationLng: 51.53,
      bookingType: 'HOURLY', pricingModel: 'PER_PERSON',
      pricePerPerson: 100, capacity: 10,
      durationValue: 2,
      checkInTime: '09:00', checkOutTime: '21:00',
      coverImage: '/placeholder.webp',
      status: 'ACTIVE',
    },
  });

  // Platform settings — singleton row
  await prisma.platformSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', defaultCommissionPct: 10, platformName: 'Jadwal Test' },
    update: {},
  });

  return { country, city, category, vendor, vendorUser, customer, activity };
}
