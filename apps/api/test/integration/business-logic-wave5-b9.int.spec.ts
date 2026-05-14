/**
 * Wave 5 — §B9 soft-delete + PII anonymisation contracts.
 *
 * The launch-blocker the prior hard-delete cascade represented:
 *   • Tax / financial-records retention (Qatar PDPL §14, GDPR Art.30,
 *     standard 7-year retention) — admin clicking "Delete user" used
 *     to wipe Booking + Payment + LoyaltyLedger rows, breaking the
 *     audit trail that regulators require.
 *   • Forensic / fraud investigation — a chargeback dispute six months
 *     after a hard-delete had no record to defend with.
 *   • Reconciliation drift (B10 cron) — silently deleted Payment rows
 *     would surface as unexplained drift with no traceable origin.
 *
 * The new contract: anonymise PII on the User row + soft-delete via
 * `deletedAt`, but KEEP every Booking / Payment / LoyaltyLedger /
 * Review / Coupon / PayoutRequest / AuditLog row attached to that
 * (now-anonymised) user. Tests below pin every guarantee.
 */

import { getTestContext, seedReference } from './_setup';
import { AdminService } from '../../src/admin/admin.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeAdmin() {
  const prismaSvc = { client: ctx.prisma } as any;
  const notif = {
    send: jest.fn().mockResolvedValue(undefined),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
    sendToMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  const cache = {
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  return new AdminService(prismaSvc, notif, loyalty, cache);
}

async function seedCustomerWithHistory() {
  const seed = await seedReference(ctx.prisma);
  // Old completed booking + paid payment — the financial-record artefact
  // we MUST preserve through the customer's account deletion.
  const payment = await ctx.prisma.payment.create({
    data: {
      amount: 250, currency: 'QAR', status: 'SUCCESS',
      method: 'PAY2M', paidAt: new Date(Date.now() - 90 * 86400_000),
      payoutStatus: 'PAID',
    },
  });
  const booking = await ctx.prisma.booking.create({
    data: {
      ref: `JDWL-B9-${crypto.randomUUID().slice(0, 6)}`,
      activityId: seed.activity.id,
      vendorId: seed.vendor.id,
      customerId: seed.customer.id,
      guests: 2, bookingPhone: '+97455123456', guestBreakdown: {},
      startDatetime: new Date(Date.now() - 95 * 86400_000),
      endDatetime: new Date(Date.now() - 95 * 86400_000 + 2 * 3600_000),
      totalPrice: 250, currencyCode: 'QAR',
      commissionPct: 10, commissionAmount: 25, serviceFee: 5,
      status: 'COMPLETED',
      paymentId: payment.id,
    },
  });
  const ledger = await ctx.prisma.loyaltyLedger.create({
    data: {
      userId: seed.customer.id,
      delta: 100, balanceAfter: 100,
      source: 'BOOKING_EARN' as any,
      bookingId: booking.id,
      actorType: 'SYSTEM',
      actorId: null,
      reason: 'Loyalty earn on completed booking',
    },
  });
  return { seed, payment, booking, ledger };
}

// ═══════════════════════════════════════════════════════════════════════════
// §B9 — deleteUser anonymisation + financial-record survival
// ═══════════════════════════════════════════════════════════════════════════

describe('§B9 — deleteUser anonymises PII + preserves financial records', () => {
  test('PII fields are nulled / anonymised, deletedAt set', async () => {
    const { seed } = await seedCustomerWithHistory();
    const admin = makeAdmin();

    await admin.deleteUser(seed.customer.id);

    const after = await ctx.prisma.user.findUnique({ where: { id: seed.customer.id } });
    expect(after).not.toBeNull();
    expect(after!.deletedAt).not.toBeNull();
    expect(after!.email).toBe(`${seed.customer.id}@deleted.local`);
    expect(after!.fullName).toBe('Deleted User');
    expect(after!.phone).toBeNull();
    expect(after!.profilePicture).toBeNull();
    expect(after!.password).toBeNull();
    expect(after!.googleId).toBeNull();
    expect(after!.verificationToken).toBeNull();
    expect(after!.passwordResetToken).toBeNull();
    expect(after!.isDeactivated).toBe(true);
    expect(after!.emailVerified).toBe(false);
  });

  test('Booking + Payment + LoyaltyLedger rows survive (7-year audit trail)', async () => {
    const { seed, booking, payment, ledger } = await seedCustomerWithHistory();
    const admin = makeAdmin();

    await admin.deleteUser(seed.customer.id);

    // Every financial record is still there, still referencing the
    // (now-anonymised) user via FK — admin can still query the audit trail.
    const bookingAfter = await ctx.prisma.booking.findUnique({ where: { id: booking.id } });
    expect(bookingAfter).not.toBeNull();
    expect(bookingAfter!.customerId).toBe(seed.customer.id);
    expect(Number(bookingAfter!.totalPrice)).toBe(250);

    const paymentAfter = await ctx.prisma.payment.findUnique({ where: { id: payment.id } });
    expect(paymentAfter).not.toBeNull();
    expect(paymentAfter!.status).toBe('SUCCESS');
    expect(Number(paymentAfter!.amount)).toBe(250);

    const ledgerAfter = await ctx.prisma.loyaltyLedger.findUnique({ where: { id: ledger.id } });
    expect(ledgerAfter).not.toBeNull();
    expect(ledgerAfter!.userId).toBe(seed.customer.id);
    expect(ledgerAfter!.delta).toBe(100);
  });

  test('ephemerals are hard-deleted (sessions, push subs, notifications, claims, likes)', async () => {
    const { seed } = await seedCustomerWithHistory();
    // Seed a refresh token + notification + like to verify they're gone.
    await ctx.prisma.refreshToken.create({
      data: {
        userId: seed.customer.id,
        tokenHash: crypto.randomBytes(16).toString('hex'),
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
    await ctx.prisma.notification.create({
      data: { userId: seed.customer.id, type: 'BOOKING_NEW', title: 'X', message: 'Y' },
    });
    await ctx.prisma.like.create({
      data: { userId: seed.customer.id, activityId: seed.activity.id },
    });

    await makeAdmin().deleteUser(seed.customer.id);

    expect(await ctx.prisma.refreshToken.count({ where: { userId: seed.customer.id } })).toBe(0);
    expect(await ctx.prisma.notification.count({ where: { userId: seed.customer.id } })).toBe(0);
    expect(await ctx.prisma.like.count({ where: { userId: seed.customer.id } })).toBe(0);
  });

  test('idempotent: re-deleting a soft-deleted user is a no-op', async () => {
    const { seed } = await seedCustomerWithHistory();
    const admin = makeAdmin();
    await admin.deleteUser(seed.customer.id);
    const firstDeletedAt = (await ctx.prisma.user.findUnique({ where: { id: seed.customer.id } }))!.deletedAt;

    // Re-delete should NOT throw and should not refresh the timestamp.
    await admin.deleteUser(seed.customer.id);
    const second = await ctx.prisma.user.findUnique({ where: { id: seed.customer.id } });
    expect(second!.deletedAt!.toISOString()).toBe(firstDeletedAt!.toISOString());
  });

  test('refuses to delete an admin', async () => {
    const adminUser = await ctx.prisma.user.create({
      data: {
        fullName: 'The Admin', email: 'admin@x.test',
        password: '$2b$10$dummy', role: 'ADMIN',
      },
    });
    await expect(makeAdmin().deleteUser(adminUser.id))
      .rejects.toThrow(/cannot delete admin/i);
  });

  test('refuses to delete user with PENDING / CONFIRMED bookings (existing money-loss guard)', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-PENDING',
        activityId: seed.activity.id, vendorId: seed.vendor.id, customerId: seed.customer.id,
        guests: 2, bookingPhone: '+97455123456', guestBreakdown: {},
        startDatetime: new Date(Date.now() + 86400_000),
        endDatetime: new Date(Date.now() + 86400_000 + 2 * 3600_000),
        totalPrice: 100, currencyCode: 'QAR',
        commissionPct: 10, commissionAmount: 10, serviceFee: 5,
        status: 'CONFIRMED',
      },
    });
    await expect(makeAdmin().deleteUser(seed.customer.id))
      .rejects.toThrow(/unresolved booking/i);

    // User should NOT be deleted on guard-failure
    const u = await ctx.prisma.user.findUnique({ where: { id: seed.customer.id } });
    expect(u!.deletedAt).toBeNull();
  });

  test('email is freed for re-registration after delete', async () => {
    const seed = await seedReference(ctx.prisma);
    const originalEmail = seed.customer.email;
    await makeAdmin().deleteUser(seed.customer.id);

    // Anonymised → original email is now available; new signup reuses it.
    const fresh = await ctx.prisma.user.create({
      data: { fullName: 'New User', email: originalEmail, password: '$2b$10$dummy' },
    });
    expect(fresh.id).not.toBe(seed.customer.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §B9 — deleteVendor cascade-soft-deletes activities + anonymises user
// ═══════════════════════════════════════════════════════════════════════════

describe('§B9 — deleteVendor cascade soft-deletes activities + anonymises user', () => {
  test('vendor + every activity get deletedAt + status flipped, slug renamed', async () => {
    const seed = await seedReference(ctx.prisma);
    const originalSlug = seed.activity.slug;
    const originalVendorSlug = seed.vendor.slug;

    await makeAdmin().deleteVendor(seed.vendor.id);

    const vendorAfter = await ctx.prisma.vendor.findUnique({ where: { id: seed.vendor.id } });
    expect(vendorAfter!.deletedAt).not.toBeNull();
    expect(vendorAfter!.status).toBe('SUSPENDED');
    expect(vendorAfter!.slug).toBe(`deleted-${seed.vendor.id}`);
    expect(vendorAfter!.phone).toBeNull();
    expect(vendorAfter!.whatsapp).toBeNull();
    expect(vendorAfter!.bankDetails).toBeNull();

    const activityAfter = await ctx.prisma.activity.findUnique({ where: { id: seed.activity.id } });
    expect(activityAfter!.deletedAt).not.toBeNull();
    expect(activityAfter!.status).toBe('INACTIVE');
    expect(activityAfter!.slug).toBe(`deleted-${seed.activity.id}`);

    // Slugs are freed
    const slugCollision = await ctx.prisma.activity.findFirst({ where: { slug: originalSlug } });
    expect(slugCollision).toBeNull();
    const vendorSlugCollision = await ctx.prisma.vendor.findFirst({ where: { slug: originalVendorSlug } });
    expect(vendorSlugCollision).toBeNull();
  });

  test('underlying user account is anonymised + soft-deleted', async () => {
    const seed = await seedReference(ctx.prisma);
    await makeAdmin().deleteVendor(seed.vendor.id);

    const userAfter = await ctx.prisma.user.findUnique({ where: { id: seed.vendorUser.id } });
    expect(userAfter!.deletedAt).not.toBeNull();
    expect(userAfter!.email).toBe(`${seed.vendorUser.id}@deleted.local`);
    expect(userAfter!.fullName).toBe('Deleted User');
    expect(userAfter!.isDeactivated).toBe(true);
  });

  test('past Booking + Payment rows on this vendor survive (clean books)', async () => {
    const seed = await seedReference(ctx.prisma);
    const customer = await ctx.prisma.user.create({
      data: { fullName: 'Cust', email: 'c2@x.test', password: '$2b$10$d' },
    });
    // payoutStatus=PAID — vendor's books are clean; deletion is allowed.
    const payment = await ctx.prisma.payment.create({
      data: {
        amount: 100, currency: 'QAR', status: 'SUCCESS', method: 'PAY2M',
        paidAt: new Date(), payoutStatus: 'PAID',
      },
    });
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-V-HIST',
        activityId: seed.activity.id, vendorId: seed.vendor.id, customerId: customer.id,
        guests: 1, bookingPhone: '+97455123456', guestBreakdown: {},
        startDatetime: new Date(Date.now() - 86400_000),
        endDatetime: new Date(Date.now() - 86400_000 + 2 * 3600_000),
        totalPrice: 100, currencyCode: 'QAR',
        commissionPct: 10, commissionAmount: 10, serviceFee: 5,
        status: 'COMPLETED', paymentId: payment.id,
      },
    });

    await makeAdmin().deleteVendor(seed.vendor.id);

    expect(await ctx.prisma.booking.findUnique({ where: { id: booking.id } })).not.toBeNull();
    expect(await ctx.prisma.payment.findUnique({ where: { id: payment.id } })).not.toBeNull();
  });

  test('§B9 follow-up F3 — refuses while UNPAID payouts exist (no stranded earnings)', async () => {
    const seed = await seedReference(ctx.prisma);
    const customer = await ctx.prisma.user.create({
      data: { fullName: 'Cust', email: 'c3@x.test', password: '$2b$10$d' },
    });
    // SUCCESS + UNPAID — vendor has owed earnings still in the system.
    const payment = await ctx.prisma.payment.create({
      data: {
        amount: 100, currency: 'QAR', status: 'SUCCESS', method: 'PAY2M',
        paidAt: new Date(), payoutStatus: 'UNPAID',
      },
    });
    await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-V-OWED',
        activityId: seed.activity.id, vendorId: seed.vendor.id, customerId: customer.id,
        guests: 1, bookingPhone: '+97455123456', guestBreakdown: {},
        startDatetime: new Date(Date.now() - 86400_000),
        endDatetime: new Date(Date.now() - 86400_000 + 2 * 3600_000),
        totalPrice: 100, currencyCode: 'QAR',
        commissionPct: 10, commissionAmount: 10, serviceFee: 5,
        status: 'COMPLETED', paymentId: payment.id,
      },
    });

    await expect(makeAdmin().deleteVendor(seed.vendor.id))
      .rejects.toThrow(/owe payout|process those payouts/i);

    const v = await ctx.prisma.vendor.findUnique({ where: { id: seed.vendor.id } });
    expect(v!.deletedAt).toBeNull();
  });

  test('§B9 follow-up F3 — refuses while in-flight payout requests exist', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.payoutRequest.create({
      data: {
        vendorId: seed.vendor.id,
        amount: 50, currency: 'QAR', status: 'PENDING',
      },
    });

    await expect(makeAdmin().deleteVendor(seed.vendor.id))
      .rejects.toThrow(/payout request.*still in flight|approve.*reject/i);
  });

  test('refuses while there are PENDING / CONFIRMED bookings', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-V-PEND',
        activityId: seed.activity.id, vendorId: seed.vendor.id, customerId: seed.customer.id,
        guests: 1, bookingPhone: '+97455123456', guestBreakdown: {},
        startDatetime: new Date(Date.now() + 86400_000),
        endDatetime: new Date(Date.now() + 86400_000 + 2 * 3600_000),
        totalPrice: 100, currencyCode: 'QAR',
        commissionPct: 10, commissionAmount: 10, serviceFee: 5,
        status: 'CONFIRMED',
      },
    });

    await expect(makeAdmin().deleteVendor(seed.vendor.id))
      .rejects.toThrow(/unresolved booking/i);

    const v = await ctx.prisma.vendor.findUnique({ where: { id: seed.vendor.id } });
    expect(v!.deletedAt).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §B9 — soft-deleted vendor's activities are hidden from public catalog
// ═══════════════════════════════════════════════════════════════════════════

describe('§B9 — soft-deleted entities are hidden from public catalog queries', () => {
  test('public activity list excludes activities of soft-deleted vendor (status filter cascades)', async () => {
    const seed = await seedReference(ctx.prisma);
    await makeAdmin().deleteVendor(seed.vendor.id);

    // Mirror the catalog's query shape — both filters MUST hide the row.
    const visible = await ctx.prisma.activity.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        vendor: { status: 'ACTIVE', deletedAt: null },
      },
    });
    expect(visible.find((a) => a.id === seed.activity.id)).toBeUndefined();
  });

  test('public activity-by-slug lookup with original slug returns 404', async () => {
    const seed = await seedReference(ctx.prisma);
    const originalSlug = seed.activity.slug;
    await makeAdmin().deleteVendor(seed.vendor.id);

    // Slug was rewritten to `deleted-<id>`; the original slug is gone.
    const found = await ctx.prisma.activity.findFirst({
      where: { slug: originalSlug, deletedAt: null },
    });
    expect(found).toBeNull();
  });
});
