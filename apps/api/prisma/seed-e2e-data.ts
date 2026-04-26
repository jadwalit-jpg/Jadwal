/**
 * Seeds the rich E2E test fixture set required by the Playwright suite to
 * exercise data-dependent flows without skipping. Idempotent — every upsert
 * is keyed off a stable identifier so re-running converges to the same state.
 *
 * Pre-req: seed-e2e-vendor.ts and seed-e2e-customer.ts have already been run.
 *
 * Creates:
 *   • An ACTIVE Activity owned by e2e-vendor (so vendor activity-list /
 *     edit + customer catalog → activity → book / coupon / loyalty all
 *     have something to land on)
 *   • A PENDING Vendor (different user) so admin-vendor-approval has a row
 *   • An APPROVED Coupon valid right now so customer-coupon-redeem +
 *     admin-coupons can act on it
 *   • A PENDING Booking on the e2e activity for vendor-booking-actions
 *   • A CONFIRMED Booking on the e2e activity for customer-booking-cancel
 *   • A CANCELLED booking with PENDING_REFUND payment for
 *     vendor-refund-decision + admin-refunds-list
 *   • COMPLETED booking with pointsAwarded so customer-loyalty has points
 *   • Bank details on the e2e vendor so payout-request is eligible
 *
 * Usage (inside the api docker container):
 *   docker compose exec -T api npx tsx prisma/seed-e2e-data.ts
 *
 * NOT FOR PRODUCTION.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const VENDOR_EMAIL = 'vendor@jadwal-test.local';
const CUSTOMER_EMAIL = 'customer@jadwal-test.local';
const PENDING_VENDOR_EMAIL = 'pending-vendor@jadwal-test.local';
const PENDING_VENDOR_PASSWORD = 'S3cure!Pass1';

const ACTIVITY_SLUG = 'e2e-activity';
const COUPON_CODE = 'E2EFIVE'; // 5 QAR off
const PENDING_BOOKING_REF = 'JDWL-E2EPND';
const CONFIRMED_BOOKING_REF = 'JDWL-E2ECNF';
const REFUND_BOOKING_REF = 'JDWL-E2ERFD';
const COMPLETED_BOOKING_REF = 'JDWL-E2ECMP';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed E2E data in production');
  }

  const adapter = new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL }));
  const prisma = new PrismaClient({ adapter } as never);

  // Resolve required pre-existing entities.
  const country = await prisma.country.findFirst();
  if (!country) throw new Error('Seed at least one Country before this script.');
  const city = await prisma.city.findFirst({ where: { countryId: country.id } });
  if (!city) throw new Error('Seed at least one City before this script.');
  const category = await prisma.category.findFirst({ where: { parentId: null } });
  if (!category) throw new Error('Seed at least one root Category before this script.');

  const vendorUser = await prisma.user.findUnique({ where: { email: VENDOR_EMAIL }, include: { vendorProfile: true } });
  if (!vendorUser?.vendorProfile) throw new Error(`Run seed-e2e-vendor.ts first (no vendor for ${VENDOR_EMAIL}).`);
  const customerUser = await prisma.user.findUnique({ where: { email: CUSTOMER_EMAIL } });
  if (!customerUser) throw new Error(`Run seed-e2e-customer.ts first (no user for ${CUSTOMER_EMAIL}).`);

  // ─── Ensure vendor has bank details so payout is eligible ─────────────
  await prisma.vendor.update({
    where: { id: vendorUser.vendorProfile.id },
    data: {
      bankDetails: { iban: 'QA00JDWL0000000000000000', holder: 'E2E Test Vendor', bankName: 'Test Bank' },
      phone: vendorUser.vendorProfile.phone ?? '+97400000000',
    },
  });

  // ─── ACTIVE Activity owned by e2e-vendor ──────────────────────────────
  const activity = await prisma.activity.upsert({
    where: { slug: ACTIVITY_SLUG },
    create: {
      slug: ACTIVITY_SLUG,
      vendorId: vendorUser.vendorProfile.id,
      countryId: country.id,
      categoryId: category.id,
      cityId: city.id,
      titleEn: 'E2E Desert Tour',
      titleAr: 'جولة الصحراء التجريبية',
      descriptionEn: 'A fixed test activity used by Playwright specs. Do not use in production. This description is intentionally long enough to satisfy the wizard validation rules (min 50 chars).',
      descriptionAr: 'نشاط ثابت يستخدمه اختبار Playwright. هذا الوصف طويل بما فيه الكفاية لتلبية قواعد التحقق من صحة المعالج (50 حرفًا كحد أدنى).',
      pricePerPerson: 100,
      durationValue: 2,
      capacity: 20,
      locationLat: 25.286,
      locationLng: 51.534,
      locationAddress: 'Doha, Qatar',
      bookingType: 'HOURLY',
      pricingModel: 'PER_PERSON',
      checkInTime: '08:00',
      checkOutTime: '22:00',
      status: 'ACTIVE',
      isFeatured: false,
      activeDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    },
    update: {
      status: 'ACTIVE',
      vendorId: vendorUser.vendorProfile.id,
      countryId: country.id,
      categoryId: category.id,
      cityId: city.id,
      descriptionEn: 'A fixed test activity used by Playwright specs. Do not use in production. This description is intentionally long enough to satisfy the wizard validation rules (min 50 chars).',
      descriptionAr: 'نشاط ثابت يستخدمه اختبار Playwright. هذا الوصف طويل بما فيه الكفاية لتلبية قواعد التحقق من صحة المعالج (50 حرفًا كحد أدنى).',
    },
  });

  // ─── PENDING Vendor for admin-vendor-approval ─────────────────────────
  const pendingHash = await bcrypt.hash(PENDING_VENDOR_PASSWORD, 12);
  const pendingUser = await prisma.user.upsert({
    where: { email: PENDING_VENDOR_EMAIL },
    create: {
      email: PENDING_VENDOR_EMAIL,
      fullName: 'Pending Vendor',
      password: pendingHash,
      role: 'VENDOR',
      emailVerified: true,
    },
    update: {
      password: pendingHash,
      role: 'VENDOR',
      emailVerified: true,
      lockedUntil: null,
    },
  });
  await prisma.vendor.upsert({
    where: { userId: pendingUser.id },
    create: {
      userId: pendingUser.id,
      businessNameEn: 'Pending Test Vendor',
      businessNameAr: 'بائع قيد المراجعة',
      businessId: 'E2E-PENDING-0001',
      slug: 'e2e-pending-vendor',
      countryId: country.id,
      status: 'PENDING',
    },
    update: { status: 'PENDING', countryId: country.id },
  });

  // ─── APPROVED Coupon valid right now ─────────────────────────────────
  const validFrom = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const validTo = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await prisma.coupon.upsert({
    where: { code: COUPON_CODE },
    create: {
      code: COUPON_CODE,
      vendorId: vendorUser.vendorProfile.id,
      discountType: 'FIXED',
      discountValue: 5,
      validFrom,
      validTo,
      status: 'APPROVED',
    },
    update: {
      validFrom,
      validTo,
      status: 'APPROVED',
      discountType: 'FIXED',
      discountValue: 5,
      vendorId: vendorUser.vendorProfile.id,
    },
  });

  // ─── Bookings ─────────────────────────────────────────────────────────
  // PENDING: future date so vendor-booking-actions can confirm/reject it
  const pendingStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const pendingEnd = new Date(pendingStart.getTime() + 2 * 60 * 60 * 1000);
  await prisma.booking.upsert({
    where: { ref: PENDING_BOOKING_REF },
    create: {
      ref: PENDING_BOOKING_REF,
      activityId: activity.id,
      vendorId: vendorUser.vendorProfile.id,
      customerId: customerUser.id,
      startDatetime: pendingStart,
      endDatetime: pendingEnd,
      guests: 2,
      totalPrice: 200,
      serviceFee: 0,
      status: 'PENDING',
    },
    update: {
      status: 'PENDING',
      startDatetime: pendingStart,
      endDatetime: pendingEnd,
    },
  });

  // CONFIRMED: future date so customer-booking-cancel-refund can cancel
  const confirmedStart = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const confirmedEnd = new Date(confirmedStart.getTime() + 2 * 60 * 60 * 1000);
  await prisma.booking.upsert({
    where: { ref: CONFIRMED_BOOKING_REF },
    create: {
      ref: CONFIRMED_BOOKING_REF,
      activityId: activity.id,
      vendorId: vendorUser.vendorProfile.id,
      customerId: customerUser.id,
      startDatetime: confirmedStart,
      endDatetime: confirmedEnd,
      guests: 2,
      totalPrice: 200,
      serviceFee: 0,
      status: 'CONFIRMED',
    },
    update: {
      status: 'CONFIRMED',
      startDatetime: confirmedStart,
      endDatetime: confirmedEnd,
    },
  });

  // CANCELLED + REFUND_PENDING: vendor-refund-decision + admin-refunds-list
  const refundStart = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
  const refundEnd = new Date(refundStart.getTime() + 2 * 60 * 60 * 1000);
  const refundBooking = await prisma.booking.upsert({
    where: { ref: REFUND_BOOKING_REF },
    create: {
      ref: REFUND_BOOKING_REF,
      activityId: activity.id,
      vendorId: vendorUser.vendorProfile.id,
      customerId: customerUser.id,
      startDatetime: refundStart,
      endDatetime: refundEnd,
      guests: 1,
      totalPrice: 100,
      serviceFee: 0,
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelledBy: 'CUSTOMER',
    },
    update: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelledBy: 'CUSTOMER',
    },
  });
  // Link a payment in REFUND_PENDING state — distinct gatewayTxnId per ref
  // because the field is @unique.
  const refundPayment = await prisma.payment.upsert({
    where: { gatewayTxnId: `E2E-REFUND-TXN-${REFUND_BOOKING_REF}` },
    create: {
      bookingId: refundBooking.id,
      amount: 100,
      currency: 'QAR',
      gatewayTxnId: `E2E-REFUND-TXN-${REFUND_BOOKING_REF}`,
      status: 'REFUND_PENDING',
      method: 'CARD',
      paidAt: refundStart,
    },
    update: { status: 'REFUND_PENDING', bookingId: refundBooking.id },
  });
  await prisma.booking.update({
    where: { id: refundBooking.id },
    data: { paymentId: refundPayment.id },
  });

  // COMPLETED + pointsAwarded — gives the customer real loyalty points,
  // AND attaches a SUCCESS payment with payoutStatus=UNPAID so the
  // vendor's earnings page shows an eligible balance for payout-request.
  const completedStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const completedEnd = new Date(completedStart.getTime() + 2 * 60 * 60 * 1000);
  const completedBooking = await prisma.booking.upsert({
    where: { ref: COMPLETED_BOOKING_REF },
    create: {
      ref: COMPLETED_BOOKING_REF,
      activityId: activity.id,
      vendorId: vendorUser.vendorProfile.id,
      customerId: customerUser.id,
      startDatetime: completedStart,
      endDatetime: completedEnd,
      guests: 1,
      totalPrice: 500,
      serviceFee: 0,
      status: 'COMPLETED',
      pointsAwarded: true,
    },
    update: {
      status: 'COMPLETED',
      pointsAwarded: true,
      totalPrice: 500,
    },
  });
  const completedPayment = await prisma.payment.upsert({
    where: { gatewayTxnId: `E2E-PAID-TXN-${COMPLETED_BOOKING_REF}` },
    create: {
      bookingId: completedBooking.id,
      amount: 500,
      currency: 'QAR',
      gatewayTxnId: `E2E-PAID-TXN-${COMPLETED_BOOKING_REF}`,
      status: 'SUCCESS',
      payoutStatus: 'UNPAID',
      method: 'CARD',
      paidAt: completedStart,
    },
    update: {
      status: 'SUCCESS',
      payoutStatus: 'UNPAID',
      bookingId: completedBooking.id,
    },
  });
  await prisma.booking.update({
    where: { id: completedBooking.id },
    data: { paymentId: completedPayment.id },
  });

  // Set a non-zero loyalty balance directly so customer-loyalty specs see it
  // immediately (don't depend on the COMPLETED-cron to sweep ledger entries).
  await prisma.user.update({
    where: { id: customerUser.id },
    data: { loyaltyPoints: 50 },
  });

  console.log('E2E data seeded:');
  console.log('  activity:          ' + activity.slug);
  console.log('  pending-vendor:    e2e-pending-vendor (PENDING)');
  console.log('  coupon:            ' + COUPON_CODE);
  console.log('  bookings (4):      pending / confirmed / refund-pending / completed');
  console.log('  loyalty points:    50 (customer)');
  console.log('  vendor bank:       set (payout-eligible)');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
