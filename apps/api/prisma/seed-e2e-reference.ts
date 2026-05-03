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
 * when NODE_ENV=production. It is also gitleaks-clean (no secrets) and
 * the production Dockerfile excludes prisma/seed-*.ts from the image
 * (verified by the "No seed files in production Docker image" CI gate).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed E2E reference data in production');
  }

  // Country — Qatar is the seed country the rest of the integration test
  // helpers and the catalog defaults assume. isoCode is unique so upsert
  // by it.
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

  // City — Doha. (countryId, nameEn) is not unique in the schema so we
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
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
