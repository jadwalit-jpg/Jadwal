/**
 * Test-booking factory — creates a paid, CONFIRMED booking so you can test
 * the cancellation + refund-request flow through the UI without needing
 * PAY2M to actually process a payment.
 *
 * USAGE
 *   docker exec jadwal-api sh -c "cd /app/apps/api && npx ts-node scripts/create-test-booking.ts"
 *
 *   Optional flags:
 *     --email=<addr>    Reuse a different customer (default: testcustomer@jadwal.com)
 *     --guests=<n>      Guest count (default: 1)
 *     --activity=<slug> Override activity slug (default: first ACTIVE activity found)
 *     --days=<n>        Days from now for the booking (default: 7)
 *
 * WHAT IT DOES
 *   1. Looks up (or fails gracefully on) the chosen activity
 *   2. Resets the chosen customer's password to a deterministic value so you
 *      can log in immediately — TestPass123!
 *   3. Inserts a Payment (status=SUCCESS, method=PAY2M) + a Booking (status=
 *      CONFIRMED) atomically in one transaction
 *   4. Prints the login credentials + booking ref + URLs you'll need
 *
 * WHAT IT SKIPS
 *   PAY2M callback, loyalty points, coupons, availability lock. The booking
 *   is written directly to the DB to mimic the "customer paid successfully"
 *   post-callback state. From the UI's perspective it's identical to a real
 *   booking — you can cancel it, request a refund, approve/reject from the
 *   vendor and admin panels.
 *
 * SAFE TO RE-RUN
 *   Each invocation creates a new booking row with a unique JDWL- ref. Past
 *   bookings are untouched. The password reset is idempotent.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

// Configurable via CLI flags so this script can seed different scenarios.
function parseArgs(): {
  email: string;
  guests: number;
  activitySlug: string | null;
  daysFromNow: number;
} {
  const defaults = {
    email: 'testcustomer@jadwal.com',
    guests: 1,
    activitySlug: null as string | null,
    daysFromNow: 7,
  };
  for (const arg of process.argv.slice(2)) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'email' && value) defaults.email = value;
    if (key === 'guests' && value) defaults.guests = Math.max(1, parseInt(value, 10) || 1);
    if (key === 'activity' && value) defaults.activitySlug = value;
    if (key === 'days' && value) defaults.daysFromNow = Math.max(1, parseInt(value, 10) || 7);
  }
  return defaults;
}

// Known password the script sets so you can log in right after running it.
// Not an environment secret — deliberately hardcoded because this script is
// a dev-only tool and the value must round-trip via the login form.
const TEST_PASSWORD = 'TestPass123!';
const BCRYPT_COST = Number(process.env.BCRYPT_COST || 10);

async function main() {
  const { email, guests, activitySlug, daysFromNow } = parseArgs();

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL is not set. Run this inside the api container.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl, max: 5 });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as any);

  try {
    // ── 1. Resolve the activity ─────────────────────────────────────
    const activity = activitySlug
      ? await prisma.activity.findUnique({
          where: { slug: activitySlug },
          include: { country: { select: { currencyCode: true, serviceFeeFixed: true } } },
        })
      : await prisma.activity.findFirst({
          where: { status: 'ACTIVE' },
          include: { country: { select: { currencyCode: true, serviceFeeFixed: true } } },
          orderBy: { createdAt: 'asc' },
        });
    if (!activity) {
      console.error(
        activitySlug
          ? `No activity with slug=${activitySlug}`
          : 'No ACTIVE activities in the database. Seed one first.',
      );
      process.exit(1);
    }

    // ── 2. Resolve the customer + reset password ───────────────────
    const customer = await prisma.user.findUnique({ where: { email } });
    if (!customer) {
      console.error(`No user with email=${email}. Seed one first or pass --email=<existing>`);
      process.exit(1);
    }
    if (customer.role !== 'CUSTOMER') {
      console.error(`User ${email} has role=${customer.role}; need CUSTOMER for a booking.`);
      process.exit(1);
    }

    const newHash = await bcrypt.hash(TEST_PASSWORD, BCRYPT_COST);
    await prisma.user.update({
      where: { id: customer.id },
      data: {
        password: newHash,
        // Revoke any outstanding sessions so the password reset takes effect
        // everywhere — if you were already logged in elsewhere you'll need
        // to sign in again with the new password.
      },
    });
    // Revoke refresh tokens separately (foreign-keyed, not in user.update).
    await prisma.refreshToken.deleteMany({ where: { userId: customer.id } });

    // ── 3. Build booking pricing ────────────────────────────────────
    const pricePerPerson = Number(activity.pricePerPerson);
    const vendorSubtotal = pricePerPerson * guests; // totalPrice
    const commissionPct = 10; // matches the platform default — safe for a test row
    const commissionAmount = Math.round(vendorSubtotal * commissionPct) / 100;
    const serviceFee = Number(activity.country?.serviceFeeFixed ?? 0);
    const customerPaid = Math.round((vendorSubtotal + serviceFee) * 100) / 100;

    // ── 4. Booking window ──────────────────────────────────────────
    // HOURLY slot: today+N days at 10:00 UTC, 1 hour long. The cancellation
    // window should be well in the future so the vendor's refund-policy
    // check lets a full refund through if you cancel.
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + daysFromNow);
    start.setUTCHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    // ── 5. Write booking + payment atomically ──────────────────────
    const ref = `JDWL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          amount: customerPaid,
          currency: activity.country?.currencyCode ?? 'QAR',
          status: 'SUCCESS',
          payoutStatus: 'UNPAID',
          method: 'PAY2M',
          paidAt: new Date(),
          gatewayTxnId: `TEST-${ref}`,
        },
      });
      const booking = await tx.booking.create({
        data: {
          ref,
          activityId: activity.id,
          vendorId: activity.vendorId,
          customerId: customer.id,
          guests,
          totalPrice: vendorSubtotal,
          serviceFee,
          commissionPct,
          commissionAmount,
          currencyCode: activity.country?.currencyCode ?? 'QAR',
          startDatetime: start,
          endDatetime: end,
          status: 'CONFIRMED',
          paymentId: payment.id,
        },
      });
      // Backfill the reverse FK on the payment so downstream code that
      // joins the other way (admin reports, refund flow) works too.
      await tx.payment.update({
        where: { id: payment.id },
        data: { bookingId: booking.id },
      });
      return { booking, payment };
    });

    // ── 6. Print everything you need ───────────────────────────────
    console.log('\n' + '═'.repeat(60));
    console.log('  Test booking created successfully');
    console.log('═'.repeat(60));
    console.log('\n  Customer login:');
    console.log(`    email    : ${email}`);
    console.log(`    password : ${TEST_PASSWORD}`);
    console.log('\n  Booking:');
    console.log(`    ref            : ${result.booking.ref}`);
    console.log(`    id             : ${result.booking.id}`);
    console.log(`    status         : CONFIRMED`);
    console.log(`    activity       : ${activity.titleEn} (${activity.slug})`);
    console.log(`    start          : ${start.toISOString()}`);
    console.log(`    guests         : ${guests}`);
    console.log(`    vendor share   : ${vendorSubtotal.toFixed(2)} ${activity.country?.currencyCode ?? 'QAR'}`);
    console.log(`    service fee    : ${serviceFee.toFixed(2)} ${activity.country?.currencyCode ?? 'QAR'}`);
    console.log(`    customer paid  : ${customerPaid.toFixed(2)} ${activity.country?.currencyCode ?? 'QAR'}`);
    console.log('\n  Payment:');
    console.log(`    method         : PAY2M (test)`);
    console.log(`    status         : SUCCESS`);
    console.log(`    payoutStatus   : UNPAID`);
    console.log('\n  Try it:');
    console.log(`    1. Open http://localhost:3000/login`);
    console.log(`    2. Sign in with the credentials above`);
    console.log(`    3. Go to http://localhost:3000/bookings/${result.booking.id}`);
    console.log(`    4. Click "Cancel this booking" → payment → REFUND_PENDING`);
    console.log(`    5. Log in as vendor or admin → refund-requests queue`);
    console.log('\n' + '═'.repeat(60) + '\n');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
