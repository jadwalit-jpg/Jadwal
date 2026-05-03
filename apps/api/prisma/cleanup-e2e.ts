/**
 * One-shot cleanup for E2E test data on prod.
 *
 * Deletes every User row whose email ends in `@jadwal-test.local`, plus
 * the cascade of related records (Vendor row, any Bookings the test user
 * created as customer, any Activities owned by the test vendor, plus
 * test-vendor coupons). Idempotent: running twice is a no-op.
 *
 * Use case: after a pen-test or staging-mirror window, wipe the seeded
 * test users so prod has no `@jadwal-test.local` accounts lingering.
 *
 * No NODE_ENV guard: the script's only effect is deleting rows that match
 * a hardcoded email suffix (`@jadwal-test.local`) — it cannot affect real
 * users by mistake. Designed for ops invocation via ECS one-off task; not
 * exposed via any HTTP route. The matching pattern is hardcoded, NOT
 * parameterised, on purpose.
 *
 * Usage (ECS one-off):
 *   aws ecs run-task --task-definition jadwal-cleanup-e2e ...
 *
 * Local dev (docker compose):
 *   docker compose exec -T api node dist/prisma/cleanup-e2e.js
 */
import { createSeedPrisma } from './_db-helper';

const TEST_EMAIL_SUFFIX = '@jadwal-test.local';

async function main() {
  const prisma = createSeedPrisma();
  await prisma.$connect();

  const testUsers = await prisma.user.findMany({
    where: { email: { endsWith: TEST_EMAIL_SUFFIX } },
    select: { id: true, email: true },
  });

  if (testUsers.length === 0) {
    console.log(`No test users found (suffix: ${TEST_EMAIL_SUFFIX}). Nothing to clean up.`);
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${testUsers.length} test user(s) to clean up:`);
  for (const u of testUsers) {
    console.log(`  - ${u.email} (${u.id})`);
  }

  let totals = { vendors: 0, activities: 0, bookings: 0, coupons: 0, users: 0 };

  for (const u of testUsers) {
    // Activities → Bookings → Coupons → Vendor → User. Order matters
    // because of FK constraints (Vendor is parent of Activity & Coupon;
    // Activity is parent of Booking).
    const vendor = await prisma.vendor.findUnique({ where: { userId: u.id } });
    if (vendor) {
      // Coupons (vendor-scoped)
      const couponDel = await prisma.coupon.deleteMany({ where: { vendorId: vendor.id } });
      totals.coupons += couponDel.count;

      // Activities (vendor-scoped) — Bookings on these activities will
      // be deleted via the per-user booking sweep below; activities
      // themselves go after their bookings. Get the activity IDs first.
      const activities = await prisma.activity.findMany({
        where: { vendorId: vendor.id },
        select: { id: true },
      });
      // Bookings on these activities (regardless of customer)
      if (activities.length) {
        const bookingDel = await prisma.booking.deleteMany({
          where: { activityId: { in: activities.map((a) => a.id) } },
        });
        totals.bookings += bookingDel.count;
      }
      // Now safe to delete activities
      const actDel = await prisma.activity.deleteMany({ where: { vendorId: vendor.id } });
      totals.activities += actDel.count;

      // Vendor row
      await prisma.vendor.delete({ where: { id: vendor.id } });
      totals.vendors += 1;
    }

    // Bookings the user made as customer (covers test-customer's bookings
    // on activities owned by other vendors — though seed-e2e doesn't
    // create those, this is defensive).
    const customerBookingDel = await prisma.booking.deleteMany({
      where: { customerId: u.id },
    });
    totals.bookings += customerBookingDel.count;

    // Finally the user
    await prisma.user.delete({ where: { id: u.id } });
    totals.users += 1;
  }

  console.log('\nCleanup complete:');
  console.log(`  users     deleted: ${totals.users}`);
  console.log(`  vendors   deleted: ${totals.vendors}`);
  console.log(`  activities deleted: ${totals.activities}`);
  console.log(`  bookings  deleted: ${totals.bookings}`);
  console.log(`  coupons   deleted: ${totals.coupons}`);

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
