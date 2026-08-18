/**
 * Bootstrap the minimum reference data the E2E suite needs:
 *   - Country QA (ACTIVE)        — required by seed-e2e-data.ts at line 58
 *   - City Doha                  — required by seed-e2e-data.ts at line 60
 *   - Category Adventure         — required for activity creation
 *
 * Pulled out so it runs FIRST in the workflow (before seed-e2e-data.ts).
 * Idempotent — uses upsert by isoCode / slug so re-runs on a populated
 * database are no-ops rather than unique-constraint failures.
 *
 * Production guard mirrors seed-e2e-data.ts: this script refuses to run
 * when NODE_ENV=production. The production Dockerfile excludes
 * prisma/seed-*.ts (verified by ci.yml's "No seed files in production
 * Docker image" gate).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load apps/api/.env if present (matches seed-e2e-data.ts pattern). In
// CI, DATABASE_URL is injected via workflow env so this is a no-op.
dotenv.config({ path: path.join(__dirname, '../.env') });

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed E2E reference data in production');
  }

  // Prisma 7 + @prisma/adapter-pg: PrismaClient must be constructed with
  // an adapter that wraps a pg Pool. Naked `new PrismaClient()` throws
  // PrismaClientInitializationError under this setup — the same shape
  // is used in seed-admin.ts and seed-e2e-data.ts.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // Country — Qatar is the seed country the rest of the integration
    // test helpers and the catalog defaults assume. isoCode is unique.
    const country = await prisma.country.upsert({
      where: { isoCode: 'QA' },
      create: {
        nameEn: 'Qatar',
        nameAr: 'قطر',
        isoCode: 'QA',
        currencyCode: 'QAR',
        defaultTimezone: 'Asia/Qatar',
        serviceFeeFixed: 5,
        status: 'ACTIVE',
      },
      update: { status: 'ACTIVE' },
    });
    console.log(`✓ Country: ${country.nameEn} (${country.id})`);

    // City — Doha. (countryId, nameEn) is not unique in the schema so
    // findFirst + create-if-missing rather than upsert.
    const existingCity = await prisma.city.findFirst({
      where: { countryId: country.id, nameEn: 'Doha' },
    });
    const city = existingCity ?? await prisma.city.create({
      data: {
        countryId: country.id,
        nameEn: 'Doha',
        nameAr: 'الدوحة',
        lat: 25.28,
        lng: 51.53,
      },
    });
    console.log(`✓ City: ${city.nameEn} (${city.id})`);

    // Category — Adventure. Slug is unique.
    const category = await prisma.category.upsert({
      where: { slug: 'adventure' },
      create: { nameEn: 'Adventure', nameAr: 'مغامرة', slug: 'adventure' },
      update: {},
    });
    console.log(`✓ Category: ${category.nameEn} (${category.id})`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
