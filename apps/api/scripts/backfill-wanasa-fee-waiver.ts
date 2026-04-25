/**
 * One-off backfill: retroactively waive service fee on PENDING bookings
 * that predate the Wanasa fee-waiver rule.
 *
 * BACKGROUND
 *   Prior to the 2026-04-23 change, a booking where Wanasa points fully
 *   covered the vendor share but NOT the service fee was left in PENDING
 *   state with a residual cash amount (just the fee) owed via PAY2M.
 *   Under the new rule, these bookings should be CONFIRMED and the fee
 *   waived.
 *
 * WHAT THIS SCRIPT DOES (per affected booking, in a single transaction)
 *   1. If the OLD logic burned some points on the fee (pointsAppliedToFee>0),
 *      refund those points to the customer's loyalty balance and write a
 *      LoyaltyLedger row with source=ADMIN_ADJUST so the double-entry
 *      invariant (sum(delta) == balance) holds.
 *   2. booking.serviceFee           = 0
 *   3. booking.status               = 'CONFIRMED'
 *   4. booking.reservedUntil        = null            (no longer a hold)
 *   5. payment.amount               = 0
 *   6. payment.status               = 'SUCCESS'
 *   7. payment.method               = 'WANASA_POINTS'
 *   8. payment.paidAt               = now()
 *
 * ELIGIBILITY
 *   - booking.status = 'PENDING'
 *   - booking.pointsRedeemed > 0           (customer did redeem points)
 *   - booking.totalPrice = 0               (points fully covered vendor share)
 *   - booking.serviceFee > 0               (there's a fee to waive)
 *   - payment.status = 'PENDING'           (not already paid/failed)
 *
 * USAGE
 *   Preview (safe):  npx ts-node scripts/backfill-wanasa-fee-waiver.ts --dry-run
 *   Apply:           npx ts-node scripts/backfill-wanasa-fee-waiver.ts --apply
 *
 *   Dry-run prints the full list of bookings that would be modified plus a
 *   before/after diff per row. No writes. --apply runs the real migration.
 *
 *   Idempotent: re-running after a successful apply is a no-op (the
 *   eligibility filter excludes already-CONFIRMED bookings).
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const DRY_RUN = !process.argv.includes('--apply');

async function main() {
  // Mirror PrismaService's adapter+pool setup — Prisma 7 requires an explicit
  // driver adapter. Using the same DATABASE_URL the api service uses keeps
  // this script consistent with the running app (same schema, same timezone).
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL is not set. Run this inside the api container or export it manually.');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: dbUrl, max: 5 });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as any);
  try {
    const candidates = await prisma.booking.findMany({
      where: {
        status: 'PENDING',
        pointsRedeemed: { gt: 0 },
        totalPrice: 0,
        serviceFee: { gt: 0 },
        payment: { status: 'PENDING' },
      },
      select: {
        id: true,
        ref: true,
        customerId: true,
        serviceFee: true,
        pointsRedeemed: true,
        pointsDiscount: true,
        reservedUntil: true,
        payment: { select: { id: true, amount: true, status: true, method: true } },
        customer: { select: { fullName: true, email: true } },
      },
    });

    if (candidates.length === 0) {
      console.log('No PENDING Wanasa bookings with outstanding service fee found. Nothing to do.');
      return;
    }

    console.log(`\n${DRY_RUN ? '[DRY-RUN]' : '[APPLYING]'} Found ${candidates.length} booking(s) eligible for fee waiver:\n`);

    for (const b of candidates) {
      // pointsAppliedToFee = how many points the OLD logic used on the fee
      // (computable from stored data: serviceFee - payment.amount).
      // In the common case — user redeemed exactly vendor-share — this is 0.
      const feeCoveredByPoints = Number(b.serviceFee) - Number(b.payment?.amount ?? 0);
      const pointsAppliedToFee = feeCoveredByPoints > 0 ? feeCoveredByPoints : 0;

      // Load the loyalty rate so we can compute the number of POINTS
      // (integer) that correspond to `pointsAppliedToFee` in QAR.
      // Fallback to default if config row is missing.
      let pointsToRefund = 0;
      if (pointsAppliedToFee > 0) {
        const cfg = await prisma.loyaltyConfig.findUnique({ where: { id: 'singleton' } });
        const qarPerPoint = Number(cfg?.qarPerPoint ?? 0.01);
        pointsToRefund = Math.ceil(pointsAppliedToFee / qarPerPoint);
      }

      console.log(`  ${b.ref}  (customer: ${b.customer.fullName} <${b.customer.email}>)`);
      console.log(`    before: serviceFee=${b.serviceFee}, payment.amount=${b.payment?.amount}, status=PENDING`);
      console.log(`    after : serviceFee=0,                payment.amount=0,               status=CONFIRMED`);
      if (pointsToRefund > 0) {
        console.log(`    refund ${pointsToRefund} points to customer (old logic burned them on fee)`);
      }

      if (DRY_RUN) continue;

      await prisma.$transaction(async (tx) => {
        // 1. Refund points applied to fee (if any) — keep the ledger in sync
        if (pointsToRefund > 0) {
          const user = await tx.user.update({
            where: { id: b.customerId },
            data: { loyaltyPoints: { increment: pointsToRefund } },
            select: { loyaltyPoints: true },
          });
          await tx.loyaltyLedger.create({
            data: {
              userId: b.customerId,
              delta: pointsToRefund,
              balanceAfter: user.loyaltyPoints,
              source: 'ADMIN_ADJUST',
              bookingId: b.id,
              actorType: 'SYSTEM',
              reason: `backfill: waive service fee on ${b.ref} (refund points old logic burned on fee)`,
            },
          });
        }

        // 2. Waive fee + flip booking to CONFIRMED
        await tx.booking.update({
          where: { id: b.id },
          data: {
            serviceFee: 0,
            status: 'CONFIRMED',
            reservedUntil: null,
          },
        });

        // 3. Synthetic WANASA_POINTS payment record
        if (b.payment) {
          await tx.payment.update({
            where: { id: b.payment.id },
            data: {
              amount: 0,
              status: 'SUCCESS',
              method: 'WANASA_POINTS',
              paidAt: new Date(),
            },
          });
        }
      });

      console.log(`    → done`);
    }

    if (DRY_RUN) {
      console.log(`\n[DRY-RUN] No changes written. Re-run with --apply to execute.`);
    } else {
      console.log(`\n[APPLIED] ${candidates.length} booking(s) migrated.`);
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
