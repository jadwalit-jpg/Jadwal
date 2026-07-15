import { Injectable, Logger, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import { CreateActivityBlockDto } from './dto/create-activity-block.dto';
import { CreateSpecialPriceDto } from './dto/create-special-price.dto';
import { VendorPaginationDto } from './dto/vendor-query.dto';
import { Prisma } from '@prisma/client';
import { NotificationService } from '../common/services/notification.service';
import { LoyaltyService } from '../common/services/loyalty.service';
import { AvailabilityCacheService } from '../redis/availability-cache.service';
import { SessionDenylistService } from '../redis/session-denylist.service';
import { assertHourlyTimesConsistent } from '../common/validators/hourly-activity';
import { nowInTimezone } from '../common/validators/timezone';
import { refundCouponUsage } from '../bookings/bookings.service';
import { createActivityBlockCore } from './activity-blocks.logic';
import { createSpecialPriceCore, bulkCreateSpecialPricesCore } from './activity-special-prices.logic';
import { BulkSpecialPriceDto } from './dto/bulk-special-price.dto';

@Injectable()
export class VendorService {
  private readonly logger = new Logger(VendorService.name);

  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
    private loyalty: LoyaltyService,
    private availabilityCache: AvailabilityCacheService,
    private sessionDenylist: SessionDenylistService,
  ) {}

  /** Resolve vendorId from userId — throws if not found or not ACTIVE */
  async resolveVendor(userId: string) {
    const vendor = await this.prisma.client.vendor.findUnique({
      where: { userId },
      select: { id: true, status: true, countryId: true, businessNameEn: true },
    });
    if (!vendor) throw new NotFoundException('Vendor profile not found');
    if (vendor.status === 'SUSPENDED') {
      throw new ForbiddenException('Your vendor account is suspended');
    }
    return vendor;
  }

  // ─── Dashboard Stats (real data) ──────────────────────────
  async getDashboardStats(userId: string) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;

    const [
      totalActivities,
      activeActivities,
      pendingActivities,
      totalBookings,
      confirmedBookings,
      revenueResult,
    ] = await Promise.all([
      db.activity.count({ where: { vendorId: vendor.id } }),
      db.activity.count({ where: { vendorId: vendor.id, status: 'ACTIVE' } }),
      db.activity.count({ where: { vendorId: vendor.id, status: 'PENDING' } }),
      // Exclude cancelled bookings from "total" — once a customer (or the
      // vendor / admin) cancels, the booking no longer exists for
      // business-metrics purposes. Matches the treatment in getEarnings
      // (SUCCESS filter) and getActivityAnalytics.
      db.booking.count({ where: { vendorId: vendor.id, status: { not: 'CANCELLED' } } }),
      db.booking.count({ where: { vendorId: vendor.id, status: 'CONFIRMED' } }),
      db.booking.aggregate({
        where: {
          vendorId: vendor.id,
          payment: { status: 'SUCCESS' },
        },
        // pointsDiscount + couponDiscount let us reconstruct the nominal
        // bookings value. totalPrice alone UNDER-counts Wanasa-paid bookings
        // (where totalPrice=0 because loyalty points covered the vendor
        // share); bookingsValue is the full customer-facing volume, useful
        // for dashboard metrics + reconciliation with vendor expectations.
        _sum: { totalPrice: true, commissionAmount: true, pointsDiscount: true, couponDiscount: true },
      }),
    ]);

    const grossRevenue = Number(revenueResult._sum.totalPrice ?? 0);
    const totalCommission = Number(revenueResult._sum.commissionAmount ?? 0);
    const wanasaFundedValue = Number(revenueResult._sum.pointsDiscount ?? 0);
    const couponDiscounted = Number(revenueResult._sum.couponDiscount ?? 0);

    return {
      totalActivities,
      activeActivities,
      pendingActivities,
      totalBookings,
      confirmedBookings,
      // Cash-to-vendor after commission. Stays unchanged semantically so
      // payout workflows are not affected by adding Wanasa visibility.
      totalRevenue: grossRevenue - totalCommission,
      // Gross nominal value the vendor delivered. totalPrice already carries
      // the full vendor-earned amount for every booking (cash and Wanasa
      // alike), so bookingsValue = totalPrice + couponDiscount. Adding
      // pointsDiscount would double-count — it's a customer-side saving,
      // not an addition to vendor revenue.
      bookingsValue: grossRevenue + couponDiscounted,
      // Portion of the customer spend that came via Wanasa redemption.
      // Audit-only metric — not additive to bookingsValue.
      wanasaFundedValue,
    };
  }

  // ─── Activities CRUD ──────────────────────────────────────
  async getActivities(userId: string, query: VendorPaginationDto) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;
    const { page = 1, limit = 20, search, status } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ActivityWhereInput = { vendorId: vendor.id };
    if (search) {
      where.OR = [
        { titleEn: { contains: search, mode: 'insensitive' } },
        { titleAr: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) {
      where.status = status as any;
    }

    const [activities, total] = await Promise.all([
      db.activity.findMany({
        where,
        include: {
          category: { select: { nameEn: true } },
          city: { select: { nameEn: true } },
          _count: {
          select: {
            // Cancelled bookings no longer exist for business-metric
            // purposes (activity tiles, dashboard, analytics). Stay in
            // lock-step with the SUCCESS-payment filter used in revenue
            // aggregates so counts and revenue reconcile.
            bookings: { where: { status: { not: 'CANCELLED' } } },
            reviews: true,
            likes: true,
          },
        },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.activity.count({ where }),
    ]);

    return { data: activities, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getActivity(userId: string, activityId: string) {
    const vendor = await this.resolveVendor(userId);

    // Ownership in the where — same 404 for "doesn't exist" and "exists
    // but belongs to another vendor". No cross-tenant probing oracle.
    const activity = await this.prisma.client.activity.findFirst({
      where: { id: activityId, vendorId: vendor.id },
      include: {
        category: { select: { nameEn: true, nameAr: true } },
        city: { select: { nameEn: true, nameAr: true } },
        country: { select: { nameEn: true, currencyCode: true } },
        _count: {
          select: {
            // Cancelled bookings no longer exist for business-metric
            // purposes (activity tiles, dashboard, analytics). Stay in
            // lock-step with the SUCCESS-payment filter used in revenue
            // aggregates so counts and revenue reconcile.
            bookings: { where: { status: { not: 'CANCELLED' } } },
            reviews: true,
            likes: true,
          },
        },
      },
    });

    if (!activity) throw new NotFoundException('Activity not found');
    return activity;
  }

  async getActivityBySlug(userId: string, slug: string) {
    const vendor = await this.resolveVendor(userId);

    // Slug is unique platform-wide so include vendorId in the where to
    // collapse "wrong vendor" into the same 404 as "no such slug".
    const activity = await this.prisma.client.activity.findFirst({
      where: { slug, vendorId: vendor.id },
      include: {
        category: { select: { nameEn: true, nameAr: true } },
        city: { select: { nameEn: true, nameAr: true } },
        country: { select: { nameEn: true, currencyCode: true } },
        _count: {
          select: {
            // Cancelled bookings no longer exist for business-metric
            // purposes (activity tiles, dashboard, analytics). Stay in
            // lock-step with the SUCCESS-payment filter used in revenue
            // aggregates so counts and revenue reconcile.
            bookings: { where: { status: { not: 'CANCELLED' } } },
            reviews: true,
            likes: true,
          },
        },
      },
    });

    if (!activity) throw new NotFoundException('Activity not found');
    return activity;
  }

  async createActivity(userId: string, dto: CreateActivityDto) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;

    // Check slug uniqueness
    const existingSlug = await db.activity.findUnique({ where: { slug: dto.slug } });
    if (existingSlug) throw new ConflictException('Activity slug already taken');

    // Verify category exists
    const category = await db.category.findUnique({ where: { id: dto.categoryId } });
    if (!category) throw new NotFoundException('Category not found');

    // Verify city exists and belongs to vendor's country
    const city = await db.city.findUnique({ where: { id: dto.cityId } });
    if (!city) throw new NotFoundException('City not found');
    if (city.countryId !== vendor.countryId) {
      throw new ForbiddenException('City does not belong to your country');
    }

    // Capacity is required when activity has no units
    if (!dto.hasUnits && (dto.capacity == null || dto.capacity <= 0)) {
      throw new BadRequestException('Capacity is required when units are not enabled');
    }

    // HOURLY activities: duration must fit the operating window. Same check
    // as updateActivity but against DTO-only values (no merge on create).
    assertHourlyTimesConsistent({
      bookingType: dto.bookingType,
      checkInTime: dto.checkInTime,
      checkOutTime: dto.checkOutTime,
      durationValue: dto.durationValue,
    });

    const { hasUnits, unitCount, unitCapacity, ...activityData } = dto;

    // Calculate capacity from units if hasUnits is true
    let capacity = activityData.capacity ?? undefined;
    if (hasUnits && unitCount && unitCount > 0) {
      capacity = unitCount * (unitCapacity ?? 1);
    }
    // Bound the units-derived capacity to the same ceiling as the direct
    // `capacity` field (@Max(10000) on the DTO). The DTO can't express the
    // unitCount × unitCapacity product, so it's enforced here — otherwise the
    // product is unbounded and an absurd capacity could be persisted.
    if (capacity != null && capacity > 10000) {
      throw new BadRequestException('Total capacity (units × capacity per unit) cannot exceed 10000');
    }

    // Strip DTO-only fields before spreading into Prisma create. `blocks` and
    // `specialPrices` are nested sub-resources (not Activity columns) — pull them
    // out here so they don't leak into activity.create, then create them below.
    const { capacity: _cap, extraServices, blocks, specialPrices, ...restData } = activityData;

    // Create the activity AND its initial locks + special prices atomically, so
    // "set them while creating" behaves exactly like every other field — all or
    // nothing. The blocks/prices run through the SAME core logic the live
    // sub-resource endpoints use (createActivityBlockCore / createSpecialPriceCore),
    // so validation + recurring-expansion can never drift between create and edit.
    // A longer timeout covers a repeat-weekly block that fans out ~6 months of rows.
    return db.$transaction(async (tx: any) => {
      const activity = await tx.activity.create({
        data: {
          ...restData,
          extraServices: extraServices ? JSON.parse(JSON.stringify(extraServices)) : undefined,
          vendorId: vendor.id,
          countryId: vendor.countryId,
          status: 'PENDING',
          gallery: dto.gallery ?? [],
          capacity: capacity ?? null,
          hasUnits: hasUnits ?? false,
          unitCount: hasUnits ? (unitCount ?? 0) : 0,
          unitCapacity: hasUnits ? (unitCapacity ?? 1) : 1,
        },
        include: {
          category: { select: { nameEn: true } },
          city: { select: { nameEn: true } },
        },
      });

      if (blocks?.length) {
        for (const b of blocks) {
          await createActivityBlockCore(tx, activity, b);
        }
      }
      if (specialPrices?.length) {
        for (const sp of specialPrices) {
          await createSpecialPriceCore(tx, activity, sp);
        }
      }

      return activity;
    }, { timeout: 20000 });
  }

  async updateActivity(userId: string, activityId: string, dto: UpdateActivityDto) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;

    const activity = await db.activity.findFirst({
      where: { id: activityId, vendorId: vendor.id },
    });
    if (!activity) throw new NotFoundException('Activity not found');

    // If slug is being changed, check uniqueness
    if (dto.slug && dto.slug !== activity.slug) {
      const existingSlug = await db.activity.findUnique({ where: { slug: dto.slug } });
      if (existingSlug) throw new ConflictException('Activity slug already taken');
    }

    // If city is being changed, verify it belongs to vendor's country
    if (dto.cityId && dto.cityId !== activity.cityId) {
      const city = await db.city.findUnique({ where: { id: dto.cityId } });
      if (!city || city.countryId !== vendor.countryId) {
        throw new ForbiddenException('City does not belong to your country');
      }
    }

    // Editing an active activity resets it to PENDING for re-approval
    const shouldResetStatus = activity.status === 'ACTIVE';

    // Capacity is required when activity has no units
    const willHaveUnits = dto.hasUnits ?? activity.hasUnits;
    const newCapacity = dto.capacity ?? activity.capacity;
    if (!willHaveUnits && (newCapacity == null || newCapacity <= 0)) {
      throw new BadRequestException('Capacity is required when units are not enabled');
    }

    // HOURLY activities: duration must fit the operating window. Validated
    // against MERGED next-state fields so partial PATCHes are checked against
    // the current activity's values where the DTO omits them.
    assertHourlyTimesConsistent(
      {
        bookingType: dto.bookingType ?? activity.bookingType,
        checkInTime: dto.checkInTime ?? activity.checkInTime,
        checkOutTime: dto.checkOutTime ?? activity.checkOutTime,
        durationValue: dto.durationValue ?? activity.durationValue,
      },
      // Grid-check only the times THIS update sets — a legacy off-grid activity
      // must stay editable on unrelated fields (window check still uses merged).
      { checkIn: dto.checkInTime !== undefined, checkOut: dto.checkOutTime !== undefined },
    );

    const { hasUnits, unitCount, unitCapacity, ...activityData } = dto;

    // Recalculate capacity from units, using MERGED next-state values (DTO
    // value ?? current DB value) for all three fields. A partial PATCH that
    // sends only `unitCount` (or only `unitCapacity`) to an activity that
    // already has units must still be recomputed and ceiling-checked — keying
    // off `dto.hasUnits` alone would let such a PATCH slip past the limit.
    let capacityOverride: number | null | undefined;
    const mergedHasUnits = hasUnits ?? activity.hasUnits;
    if (mergedHasUnits) {
      const mergedUnitCount = unitCount ?? activity.unitCount ?? 0;
      const mergedUnitCapacity = unitCapacity ?? activity.unitCapacity ?? 1;
      if (mergedUnitCount > 0) {
        capacityOverride = mergedUnitCount * mergedUnitCapacity;
      }
    }
    // Same ceiling as createActivity / the direct `capacity` @Max(10000) —
    // the units product is otherwise unbounded.
    if (capacityOverride != null && capacityOverride > 10000) {
      throw new BadRequestException('Total capacity (units × capacity per unit) cannot exceed 10000');
    }

    // Strip DTO-only fields before spreading into Prisma update
    const { capacity: _c, categoryId, cityId, extraServices, ...restUpdateData } = activityData;

    return db.activity.update({
      where: { id: activityId },
      data: {
        ...restUpdateData,
        ...(extraServices !== undefined ? { extraServices: JSON.parse(JSON.stringify(extraServices)) } : {}),
        ...(categoryId ? { category: { connect: { id: categoryId } } } : {}),
        ...(cityId ? { city: { connect: { id: cityId } } } : {}),
        ...(hasUnits !== undefined ? { hasUnits } : {}),
        ...(unitCount !== undefined ? { unitCount } : {}),
        ...(unitCapacity !== undefined ? { unitCapacity } : {}),
        ...(capacityOverride !== undefined ? { capacity: capacityOverride } : {}),
        ...(_c !== undefined ? { capacity: _c ?? null } : {}),
        ...(shouldResetStatus ? { status: 'PENDING' } : {}),
      },
      include: {
        category: { select: { nameEn: true } },
        city: { select: { nameEn: true } },
      },
    });
  }

  async deleteActivity(userId: string, activityId: string) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;

    const activity = await db.activity.findFirst({
      where: { id: activityId, vendorId: vendor.id },
      // Non-cancelled count is informational here; the hard gate below is
      // the `activeBookings` query which inspects PENDING + CONFIRMED only.
      include: { _count: { select: { bookings: { where: { status: { not: 'CANCELLED' } } } } } },
    });

    if (!activity) throw new NotFoundException('Activity not found');

    // Don't allow deletion if there are active bookings
    const activeBookings = await db.booking.count({
      where: {
        activityId,
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
    });
    if (activeBookings > 0) {
      throw new ForbiddenException('Cannot delete activity with active bookings. Cancel them first.');
    }

    return db.activity.delete({ where: { id: activityId } });
  }

  // ─── Bookings ─────────────────────────────────────────────
  async getBookings(userId: string, query: VendorPaginationDto) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;
    const { page = 1, limit = 20, status } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.BookingWhereInput = { vendorId: vendor.id };
    if (status) where.status = status as any;
    if (query.activityId) where.activityId = query.activityId;
    if (query.dateFrom || query.dateTo) {
      where.startDatetime = {};
      if (query.dateFrom) (where.startDatetime as any).gte = new Date(query.dateFrom);
      if (query.dateTo) (where.startDatetime as any).lte = new Date(query.dateTo);
    }
    // Search by booking ref, customer name/account phone, OR the
    // per-booking phone (vendor's primary contact for this booking).
    if (query.search) {
      const s = query.search.trim();
      where.OR = [
        { ref: { contains: s, mode: 'insensitive' } },
        { bookingPhone: { contains: s, mode: 'insensitive' } },
        { customer: { fullName: { contains: s, mode: 'insensitive' } } },
        { customer: { phone: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const [bookings, total] = await Promise.all([
      db.booking.findMany({
        where,
        include: {
          // Vendor needs `fullName` to greet the customer + `phone` to
          // coordinate the booking. `email` is intentionally OMITTED:
          // vendors don't operationally need to email customers directly
          // — the platform's booking-confirmation + vendor-notification
          // emails handle that. Withholding email minimises PII exposure
          // (PDPPL data minimisation) AND limits damage if a vendor
          // account is compromised: the attacker can't harvest a target
          // list of customer email addresses for spam/phishing.
          //
          // If a future vendor support workflow needs vendor-to-customer
          // email, route it through a platform-mediated endpoint that
          // audits + rate-limits each outbound message.
          customer: { select: { fullName: true, phone: true } },
          // bookingType + durationValue let the UI render the actual booked
          // time range for HOURLY bookings (now flex-length), not just the
          // date. Without these the vendor can't tell if a customer booked
          // 2h or 8h at a glance.
          activity: { select: { titleEn: true, bookingType: true, durationValue: true, country: { select: { currencyCode: true } } } },
          payment: { select: { status: true, method: true, paidAt: true, amount: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.booking.count({ where }),
    ]);

    return { data: bookings, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async updateBookingStatus(userId: string, bookingId: string, newStatus: string) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;

    const booking = await db.booking.findFirst({
      where: { id: bookingId, vendorId: vendor.id },
      select: {
        id: true, ref: true, vendorId: true, activityId: true, customerId: true, status: true, totalPrice: true, pointsRedeemed: true, pointsDiscount: true, pointsAwarded: true, endDatetime: true, couponCode: true,
        activity: { select: { titleEn: true, country: { select: { defaultTimezone: true } } } },
        payment: { select: { id: true, status: true, amount: true } },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const allowed = ['CONFIRMED', 'COMPLETED', 'CANCELLED'];
    if (!allowed.includes(newStatus)) {
      throw new ForbiddenException(`Invalid status. Allowed: ${allowed.join(', ')}`);
    }

    // Guard: COMPLETED means "the event has occurred". Reject the transition
    // if the booking's end time is still in the future — otherwise a vendor
    // clicking Complete early awards loyalty points prematurely AND notifies
    // the customer their event finished before it actually did. endDatetime is
    // local-wall-clock tagged-UTC, so we compare against nowInTimezone(activity
    // tz) — NOT raw Date.now(), which in a +offset country (Qatar +3) would
    // reject a genuinely-finished booking for ~3h. Matches the auto-complete
    // cron (CleanupService.autoCompletePastBookings) so backend + cron agree.
    const completeTz = booking.activity?.country?.defaultTimezone ?? 'UTC';
    if (newStatus === 'COMPLETED' && booking.endDatetime.getTime() > nowInTimezone(completeTz).getTime()) {
      throw new ForbiddenException(
        'Cannot complete a booking before its end time has passed',
      );
    }

    let cancelledNow = false;
    // Captured when a cancel refunds a booking whose vendor payout was already
    // PAID — surfaced to admins after commit for manual recovery (no auto-clawback).
    let clawbackNeeded: { amount: number; paymentId: string; ref: string } | null = null;
    const updated = await db.$transaction(async (tx: any) => {
      // Vendor-initiated cancellation stamps cancelledAt/By for history.
      // Vendor-initiated cancel does NOT go through the refund queue — the
      // vendor is already making the call, so refund is immediate at 100%.
      //
      // CANCELLED is the money-mutating transition. Claim it optimistically so
      // exactly ONE concurrent cancel (double-click / two tabs / retried
      // request) wins — otherwise the refund + loyalty-credit block below runs
      // twice and the customer is credited their refund points twice. Mirrors
      // the customer cancelBooking guard (bookings.service.ts).
      if (newStatus === 'CANCELLED') {
        // M9 — a vendor must NOT self-cancel a booking whose payout has already
        // been PAID. Payout only happens AFTER the activity's end date, so there
        // is no legitimate reason for a vendor to cancel a completed, paid-out
        // booking; doing so refunds the customer (points) while the vendor keeps
        // the cash — a platform double-loss and a collusion vector. Route it
        // through admin, who can coordinate the clawback. Checked BEFORE the
        // CANCELLED claim so nothing is mutated on rejection.
        const paidOut = await tx.booking.findUnique({
          where: { id: bookingId },
          select: { payment: { select: { payoutStatus: true } } },
        });
        if (paidOut?.payment?.payoutStatus === 'PAID') {
          throw new ForbiddenException(
            'This booking has already been paid out and can no longer be cancelled here. Please contact support to arrange it.',
          );
        }

        const claim = await tx.booking.updateMany({
          where: { id: bookingId, status: { not: 'CANCELLED' } },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancelledBy: 'VENDOR',
            refundDecisionAt: new Date(),
            refundDecisionBy: userId,
            refundDecisionActor: 'VENDOR',
          },
        });
        if (claim.count === 0) {
          // Lost the race — already cancelled. Skip all refunds; return current row.
          return tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
        }
        cancelledNow = true;
      }

      const result =
        newStatus === 'CANCELLED'
          // Fresh in-tx snapshot AFTER winning the claim — the refund logic
          // below reads payment status, pointsRedeemed and pointsAwarded from
          // THIS row, never the pre-tx `booking` read, so a concurrent payment
          // callback or completion can't drive a stale refund.
          ? await tx.booking.findUniqueOrThrow({
              where: { id: bookingId },
              include: { payment: { select: { id: true, status: true, amount: true, payoutStatus: true } } },
            })
          : await tx.booking.update({
              where: { id: bookingId },
              data: { status: newStatus as any },
            });

      // Handle payment state when vendor cancels a paid booking.
      // Refund goes to Wanasa points (store credit), NOT back to card.
      if (newStatus === 'CANCELLED' && result.payment) {
        if (result.payment.status === 'SUCCESS') {
          const paidAmount = Number(result.payment.amount);
          await tx.payment.update({
            where: { id: result.payment.id },
            data: {
              status: 'REFUNDED',
              refundAmount: paidAmount,
              refundedAt: new Date(),
            },
          });

          // Flag for manual clawback if the vendor was ALREADY paid out for this
          // booking — the customer refund then leaves the platform out twice.
          if (result.payment.payoutStatus === 'PAID') {
            clawbackNeeded = { amount: paidAmount, paymentId: result.payment.id, ref: result.ref };
          }

          // Convert full refund to Wanasa points (ledger: VENDOR_REFUND_APPROVED)
          let loyaltyConfig = await tx.loyaltyConfig.findUnique({ where: { id: 'singleton' } });
          if (!loyaltyConfig) loyaltyConfig = await tx.loyaltyConfig.create({ data: { id: 'singleton' } });
          const qarPerPoint = loyaltyConfig.qarPerPoint.toNumber();
          // Points are QAR-denominated (1 pt = 1 QAR): round to 2 dp, don't floor
          // (a 50.75 QAR refund → 50.75 points). Mirrors the customer/admin paths.
          const refundPoints = qarPerPoint > 0 ? Math.round((paidAmount / qarPerPoint) * 100) / 100 : 0;
          if (refundPoints > 0) {
            await this.loyalty.refund(tx, {
              userId: result.customerId,
              amount: refundPoints,
              bookingId,
              source: 'VENDOR_REFUND_APPROVED',
              actorType: 'VENDOR',
              actorId: userId,
              note: `Vendor cancel: ${paidAmount} refund → ${refundPoints} points, booking ${result.ref}`,
            });
          }
        } else if (result.payment.status === 'PENDING') {
          await tx.payment.update({
            where: { id: result.payment.id },
            data: { status: 'FAILED' },
          });
        }

        // Refund redeemed loyalty points back to customer (ledger: CANCEL_REFUND_PAID)
        const redeemedPoints = Number(result.pointsRedeemed) || 0;
        if (redeemedPoints > 0) {
          await this.loyalty.refund(tx, {
            userId: result.customerId,
            amount: redeemedPoints,
            bookingId,
            source: 'CANCEL_REFUND_PAID',
            actorType: 'VENDOR',
            actorId: userId,
            note: `Vendor cancel returned redeemed points on booking ${result.ref}`,
          });
        }

        // Reverse points AWARDED on a COMPLETED booking the vendor is now
        // cancelling. Without this the customer keeps the earned points PLUS the
        // cash-refund-as-points above — a vendor↔customer collusion double-dip
        // (let it complete → customer earns points → cancel → keep points + get
        // refunded). Mirrors the admin cancel path (admin.service.ts). Uses the
        // same cash-only earn basis (LoyaltyService.computeEarnedPoints) as the
        // award so the reversal matches exactly — a points-paid booking earned 0
        // and reverses 0; pointsAwarded is flipped false alongside the
        // debit so it can't double-reverse. reverseAwarded clamps to the current
        // balance so it never drives the balance negative.
        if (result.pointsAwarded === true) {
          // Reverse the EXACT points credited on this booking (its BOOKING_EARN
          // ledger row), NOT a recompute with the CURRENT earn rate — an admin
          // rate change between award and cancel would otherwise debit the wrong
          // amount (or 0, leaving free residual points). 0 → nothing to reverse
          // (points-paid booking earned 0). pointsAwarded → false so a re-cancel
          // can't double-reverse.
          const awardedPoints = await this.loyalty.getEarnedPoints(tx, bookingId);
          if (awardedPoints > 0) {
            await this.loyalty.reverseAwarded(tx, {
              userId: result.customerId,
              amount: awardedPoints,
              bookingId,
              actorType: 'VENDOR',
              actorId: userId,
              note: `Vendor cancel of COMPLETED booking ${result.ref} — debiting ${awardedPoints} previously-awarded points`,
            });
            await tx.booking.update({
              where: { id: bookingId },
              data: { pointsAwarded: false },
            });
          }
        }

        // Refund the coupon usage so usage counters stay accurate and
        // platform vouchers become re-applicable on future bookings.
        await refundCouponUsage(tx, result.couponCode, result.customerId);
      }

      // Award loyalty points when booking becomes COMPLETED (ledger: BOOKING_EARN)
      if (newStatus === 'COMPLETED' && !booking.pointsAwarded) {
        let config = await tx.loyaltyConfig.findUnique({ where: { id: 'singleton' } });
        if (!config) {
          config = await tx.loyaltyConfig.create({ data: { id: 'singleton' } });
        }
        // Use the SHARED earn basis (LoyaltyService.computeEarnedPoints): 2-dp
        // round (not floor, so sub-100 QAR bookings still earn their 1%), on the
        // CASH paid only (totalPrice − pointsDiscount, so a points-paid booking
        // earns 0 — no minting loop). Byte-identical to the cron + admin earn so
        // the later reverse-on-cancel (which also uses computeEarnedPoints) matches
        // exactly and never leaves a residual balance.
        const points = this.loyalty.computeEarnedPoints(
          Number(booking.totalPrice),
          Number(booking.pointsDiscount),
          config.pointsPerQar.toNumber(),
        );
        if (points > 0) {
          // Atomically CLAIM the award: flip pointsAwarded false→true only if it
          // is still false. The status→COMPLETED update above is NOT a claim, so
          // two concurrent completes (double-click / two tabs) both pass the stale
          // pre-tx `!booking.pointsAwarded` check and reach here; only ONE wins
          // this claim → only one earns. (Previously the double-earn was stopped
          // solely by the conditional, not-in-schema unique ledger index.)
          const claim = await tx.booking.updateMany({
            where: { id: bookingId, pointsAwarded: false },
            data: { pointsAwarded: true },
          });
          if (claim.count === 1) {
            await this.loyalty.earn(tx, {
              userId: booking.customerId,
              amount: points,
              bookingId,
              note: `Earned on booking ${booking.ref} (${Number(booking.totalPrice)})`,
            });
            // Notify customer (fire-and-forget, after transaction)
            this.notificationService.send({
              userId: booking.customerId,
              type: 'SYSTEM' as any,
              title: 'Points Earned!',
              message: `You earned ${points} WANASA points for booking ${booking.ref}`,
              link: '/bookings',
            });
          }
        }
      }

      return result;
    });

    // CANCELLED is the only transition that frees capacity. CONFIRMED and
    // COMPLETED both consume capacity identically, so those don't require a
    // cache bump.
    if (newStatus === 'CANCELLED' && cancelledNow) {
      void this.availabilityCache.invalidate(booking.activityId);

      // Customer notification — they didn't initiate this cancel, so they need
      // to be told. Fire-and-forget; NotificationService handles its own errors.
      // `activity.titleEn` comes from DB (not user input), so no XSS surface.
      const wasPaid = booking.payment?.status === 'SUCCESS';
      const refundLine = wasPaid
        ? ' Your payment has been refunded as Wanasa points to your balance.'
        : '';
      this.notificationService.send({
        userId: booking.customerId,
        type: 'BOOKING_CANCELLED',
        title: 'Your booking was cancelled',
        message: `The vendor cancelled booking ${booking.ref} for "${booking.activity.titleEn}".${refundLine}`,
        link: `/bookings/${bookingId}`,
      });

      // Cancel-after-payout: the vendor was already paid for this booking, so the
      // customer refund leaves the platform out-of-pocket. Flag for MANUAL
      // recovery (policy: no auto-clawback) — alert admins + a durable log.
      // clawbackNeeded is assigned inside the $transaction closure above; TS's
      // control-flow can't see closure mutations, so re-widen via an explicit cast.
      const clawback = clawbackNeeded as { amount: number; paymentId: string; ref: string } | null;
      if (clawback) {
        this.logger.warn({
          event: 'PAYOUT_CLAWBACK_NEEDED',
          paymentId: clawback.paymentId,
          bookingRef: clawback.ref,
          amount: clawback.amount,
        });
        this.notificationService.notifyAdmins({
          type: 'SYSTEM',
          title: 'Payout clawback needed',
          message: `Vendor-cancelled booking ${clawback.ref} was refunded, but its payout was already PAID (${clawback.amount}). Recover the vendor's share manually.`,
          link: '/admin/payouts',
        });
      }
    }

    return updated;
  }

  // ─── Reviews ──────────────────────────────────────────────
  async getReviews(userId: string, query: VendorPaginationDto) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const [reviews, total] = await Promise.all([
      db.review.findMany({
        where: { activity: { vendorId: vendor.id } },
        include: {
          customer: { select: { fullName: true } },
          activity: { select: { titleEn: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.review.count({ where: { activity: { vendorId: vendor.id } } }),
    ]);

    return { data: reviews, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async replyToReview(userId: string, reviewId: string, reply: string) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;

    // Vendor scope is on the related activity row — collapse cross-vendor
    // 403 into the same 404 as "review doesn't exist".
    const review = await db.review.findFirst({
      where: { id: reviewId, activity: { vendorId: vendor.id } },
      include: { activity: { select: { vendorId: true } } },
    });
    if (!review) throw new NotFoundException('Review not found');

    return db.review.update({ where: { id: reviewId }, data: { vendorReply: reply } });
  }

  // ─── Earnings ─────────────────────────────────────────────
  async getEarnings(userId: string) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;

    const [totalEarnedResult, pendingPayoutResult, recentPayments] = await Promise.all([
      // Sum vendor's net share (totalPrice - commissionAmount). Wanasa-paid
      // bookings have totalPrice=0 by design (points covered the vendor
      // share), so they contribute 0 here — that's correct for payout
      // arithmetic. bookingsValue / wanasaFundedValue below surface the
      // missing context.
      db.booking.aggregate({
        where: { vendorId: vendor.id, payment: { status: 'SUCCESS', payoutStatus: 'PAID' } },
        _sum: { totalPrice: true, commissionAmount: true, pointsDiscount: true, couponDiscount: true },
      }),
      db.booking.aggregate({
        where: { vendorId: vendor.id, payment: { status: 'SUCCESS', payoutStatus: 'UNPAID' } },
        _sum: { totalPrice: true, commissionAmount: true, pointsDiscount: true, couponDiscount: true },
      }),
      db.booking.findMany({
        where: { vendorId: vendor.id, payment: { status: 'SUCCESS' } },
        select: {
          ref: true, totalPrice: true, commissionAmount: true, serviceFee: true, currencyCode: true,
          // Loyalty + coupon fields so the payment history row can show
          // what was Wanasa-funded vs cash-funded, matching the badge/chip
          // pattern used on the bookings list.
          pointsRedeemed: true, pointsDiscount: true, couponDiscount: true, couponCode: true,
          activity: { select: { titleEn: true } },
          payment: { select: { id: true, amount: true, method: true, paidAt: true, payoutStatus: true, createdAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    // Get vendor's country currency for display
    const vendorData = await db.vendor.findUnique({
      where: { id: vendor.id },
      select: { country: { select: { currencyCode: true } } },
    });

    const totalEarned = Number(totalEarnedResult._sum.totalPrice ?? 0) - Number(totalEarnedResult._sum.commissionAmount ?? 0);
    const pendingPayout = Number(pendingPayoutResult._sum.totalPrice ?? 0) - Number(pendingPayoutResult._sum.commissionAmount ?? 0);
    // Total nominal value delivered (paid + unpaid-payout combined). Includes
    // the Wanasa + coupon-discounted portion so vendors see their real
    // business volume, not just the cash they'll withdraw.
    // Nominal bookings value = vendor's full earned amount + any coupon
    // discount they absorbed. totalPrice already includes Wanasa-paid
    // bookings at full value (platform backs the points with cash), so we
    // don't add pointsDiscount again — that would double-count.
    const paidGross = Number(totalEarnedResult._sum.totalPrice ?? 0) + Number(totalEarnedResult._sum.couponDiscount ?? 0);
    const pendingGross = Number(pendingPayoutResult._sum.totalPrice ?? 0) + Number(pendingPayoutResult._sum.couponDiscount ?? 0);
    // Audit-only: how much customer spend flowed through Wanasa. Not
    // additive to paidGross/pendingGross — overlaps with them.
    const wanasaFundedValue = Number(totalEarnedResult._sum.pointsDiscount ?? 0) + Number(pendingPayoutResult._sum.pointsDiscount ?? 0);

    return {
      currency: vendorData?.country?.currencyCode ?? 'QAR',
      totalEarned,
      pendingPayout,
      bookingsValue: paidGross + pendingGross,
      wanasaFundedValue,
      recentPayments,
    };
  }

  // ─── Settings ─────────────────────────────────────────────
  async getSettings(userId: string) {
    return this.prisma.client.vendor.findUnique({
      where: { userId },
      select: {
        id: true,
        businessNameEn: true,
        businessNameAr: true,
        descriptionEn: true,
        descriptionAr: true,
        phone: true,
        whatsapp: true,
        website: true,
        bankDetails: true,
        trustLevel: true,
        status: true,
        country: { select: { nameEn: true, currencyCode: true } },
      },
    });
  }

  async updateSettings(userId: string, body: Record<string, any>) {
    const vendor = await this.resolveVendor(userId);
    const allowed = ['businessNameEn', 'businessNameAr', 'descriptionEn', 'descriptionAr', 'phone', 'whatsapp', 'website', 'bankDetails'];
    const data: Record<string, any> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) data[key] = body[key];
    }

    // Bank-details mutation stamp — drives the payout cool-down in
    // evaluatePayoutEligibility(). We set this whenever `bankDetails`
    // appears in the request body, even if the value is identical to the
    // existing one (we don't have the prior value cheaply available, and
    // a write that "happens to match" still represents a vendor-initiated
    // touch on the field worth pausing on). Optional re-evaluation: only
    // bump when the JSON value actually differs — would require loading
    // the existing row first; the trade-off (one extra read per settings
    // update vs occasional zero-change cool-down resets) isn't worth it.
    if (body.bankDetails !== undefined) {
      data.bankDetailsChangedAt = new Date();
    }

    return this.prisma.client.vendor.update({
      where: { id: vendor.id },
      data,
      select: {
        businessNameEn: true,
        businessNameAr: true,
        descriptionEn: true,
        descriptionAr: true,
        phone: true,
        whatsapp: true,
        website: true,
        bankDetails: true,
        bankDetailsChangedAt: true,
      },
    });
  }

  // ─── Coupons ──────────────────────────────────────────────
  async getCoupons(userId: string, query: VendorPaginationDto) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const [coupons, total] = await Promise.all([
      db.coupon.findMany({
        where: { vendorId: vendor.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.coupon.count({ where: { vendorId: vendor.id } }),
    ]);

    return { data: coupons, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async toggleActivityStatus(userId: string, activityId: string) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;
    const activity = await db.activity.findFirst({
      where: { id: activityId, vendorId: vendor.id },
      select: { id: true, status: true, vendorId: true, titleEn: true },
    });
    if (!activity) throw new NotFoundException('Activity not found');
    if (!['ACTIVE', 'INACTIVE'].includes(activity.status)) {
      throw new ForbiddenException('Only active or inactive activities can be toggled');
    }

    const newStatus = activity.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

    // Block deactivation if there are future confirmed or pending bookings
    if (newStatus === 'INACTIVE') {
      const futureBookings = await db.booking.count({
        where: {
          activityId,
          status: { in: ['PENDING', 'CONFIRMED'] },
          startDatetime: { gte: new Date() },
        },
      });
      if (futureBookings > 0) {
        throw new ForbiddenException(
          `Cannot deactivate activity with ${futureBookings} upcoming booking${futureBookings > 1 ? 's' : ''}. Cancel or complete them first.`,
        );
      }
    }

    const updated = await db.activity.update({
      where: { id: activityId },
      data: { status: newStatus as any },
      select: { id: true, status: true },
    });

    // Notify admins when vendor deactivates an activity
    if (newStatus === 'INACTIVE') {
      this.notificationService.notifyAdmins({
        type: 'SYSTEM' as any,
        title: 'Activity Deactivated',
        message: `Vendor deactivated "${activity.titleEn}"`,
        link: `/admin/activities/${activityId}`,
      });
    }

    return updated;
  }

  // ─── Activity Blocks (vendor availability locks) ──────────
  async getActivityBlocks(userId: string, activityId: string) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;
    // Ownership in the where — same 404 for "not yours" and "doesn't exist".
    const activity = await db.activity.findFirst({
      where: { id: activityId, vendorId: vendor.id },
      select: { id: true },
    });
    if (!activity) throw new NotFoundException('Activity not found');

    return db.activityBlock.findMany({
      where: { activityId, deletedAt: null },
      orderBy: { blockStart: 'asc' },
      select: { id: true, blockStart: true, blockEnd: true, createdAt: true },
    });
  }

  async createActivityBlock(userId: string, activityId: string, dto: CreateActivityBlockDto) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;
    const activity = await db.activity.findFirst({
      where: { id: activityId, vendorId: vendor.id },
      select: { id: true, vendorId: true, bookingType: true, checkInTime: true, checkOutTime: true, durationValue: true },
    });
    if (!activity) throw new NotFoundException('Activity not found');

    // All validation + the slot/whole-day/recurring branches live in the shared
    // core so the vendor and admin flows can never validate differently.
    const result = await createActivityBlockCore(db, activity, dto);

    // Bust the availability cache so customers see the lock immediately.
    void this.availabilityCache.invalidate(activityId);
    return result;
  }

  async deleteActivityBlock(userId: string, activityId: string, blockId: string) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;
    const activity = await db.activity.findFirst({
      where: { id: activityId, vendorId: vendor.id },
      select: { id: true },
    });
    if (!activity) throw new NotFoundException('Activity not found');

    // Soft-delete, scoped by activity + vendor; updateMany so a double-delete
    // (or a foreign blockId) is a clean no-op → 404, never another vendor's row.
    const res = await db.activityBlock.updateMany({
      where: { id: blockId, activityId, vendorId: vendor.id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (res.count === 0) throw new NotFoundException('Block not found');

    void this.availabilityCache.invalidate(activityId);
    return { id: blockId, removed: true };
  }

  async deleteActivityBlocksBulk(userId: string, activityId: string, ids: string[]) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;
    const activity = await db.activity.findFirst({
      where: { id: activityId, vendorId: vendor.id },
      select: { id: true },
    });
    if (!activity) throw new NotFoundException('Activity not found');

    // Soft-delete the given ids, scoped to this activity + vendor (foreign or
    // already-deleted ids are simply not matched). One query → no rate-limit
    // issues even for a long recurring series.
    const res = await db.activityBlock.updateMany({
      where: { id: { in: ids }, activityId, vendorId: vendor.id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (res.count > 0) void this.availabilityCache.invalidate(activityId);
    return { removed: res.count };
  }

  // ─── Special prices (per-date price overrides) ───────────────
  // Same ownership + cache-bust pattern as activity blocks. Shared validation
  // lives in createSpecialPriceCore so vendor + admin can never diverge.
  async getActivitySpecialPrices(userId: string, activityId: string) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;
    const activity = await db.activity.findFirst({
      where: { id: activityId, vendorId: vendor.id },
      select: { id: true },
    });
    if (!activity) throw new NotFoundException('Activity not found');

    // Only current/future overrides — past dates can't be booked and the
    // calendar shows [today, +6mo]. Also bounds the result: old overrides are
    // never hard-deleted, so without a floor this query would grow over time.
    const todayUtc = new Date(new Date().toISOString().slice(0, 10));
    return db.activitySpecialPrice.findMany({
      where: { activityId, deletedAt: null, date: { gte: todayUtc } },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, price: true, createdAt: true },
    });
  }

  async createActivitySpecialPrice(userId: string, activityId: string, dto: CreateSpecialPriceDto) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;
    const activity = await db.activity.findFirst({
      where: { id: activityId, vendorId: vendor.id },
      select: { id: true, vendorId: true },
    });
    if (!activity) throw new NotFoundException('Activity not found');

    const result = await createSpecialPriceCore(db, activity, dto);
    void this.availabilityCache.invalidate(activityId);
    return result;
  }

  async bulkCreateActivitySpecialPrices(userId: string, activityId: string, dto: BulkSpecialPriceDto) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;
    const activity = await db.activity.findFirst({
      where: { id: activityId, vendorId: vendor.id },
      select: { id: true, vendorId: true },
    });
    if (!activity) throw new NotFoundException('Activity not found');

    // One transaction → all dates applied or none (a single bad/past date rolls
    // the whole batch back). Cache busted once after, not per date.
    const result = await db.$transaction(
      (tx: any) => bulkCreateSpecialPricesCore(tx, activity, dto),
      { timeout: 20000 },
    );
    void this.availabilityCache.invalidate(activityId);
    return result;
  }

  async deleteActivitySpecialPrice(userId: string, activityId: string, priceId: string) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;
    const activity = await db.activity.findFirst({
      where: { id: activityId, vendorId: vendor.id },
      select: { id: true },
    });
    if (!activity) throw new NotFoundException('Activity not found');

    // Soft-delete, scoped by activity + vendor; updateMany so a double-delete or
    // a foreign id is a clean no-op → 404, never another vendor's row.
    const res = await db.activitySpecialPrice.updateMany({
      where: { id: priceId, activityId, vendorId: vendor.id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (res.count === 0) throw new NotFoundException('Special price not found');

    void this.availabilityCache.invalidate(activityId);
    return { id: priceId, removed: true };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const db = this.prisma.client;
    // Opt back into password (globally omitted in PrismaService) for bcrypt compare.
    // Without this opt-in, user.password is undefined and the !user.password check
    // below always trips → every legit vendor password change returned 403.
    const user = await db.user.findUnique({
      where: { id: userId },
      omit: { password: false },
    } as any) as { id: string; password: string | null } | null;
    if (!user) throw new NotFoundException('User not found');
    if (!user.password) throw new ForbiddenException('This account uses Google sign-in and has no password.');
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) throw new ForbiddenException('Current password is incorrect');
    const bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 12);
    const hash = await bcrypt.hash(newPassword, bcryptRounds);
    // M5 — denylist every live session BEFORE the tx deletes the refresh rows,
    // so outstanding access tokens die immediately (not just at renewal).
    await this.sessionDenylist.denylistAllUserSessions(userId);
    // Interactive transaction (function form) — preferred over the array form
    // with Prisma 7 driver adapters; consistent with the rest of the codebase.
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { password: hash } });
      // Invalidate all refresh tokens — forces re-login on all other sessions
      await tx.refreshToken.deleteMany({ where: { userId } });
    });
    return { message: 'Password changed successfully. Please log in again.' };
  }

  async getRevenueChart(userId: string) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const result = await db.booking.aggregate({
        where: {
          vendorId: vendor.id,
          payment: { status: 'SUCCESS' },
          createdAt: { gte: start, lte: end },
        },
        // pointsDiscount + couponDiscount let the chart also plot the
        // nominal bookings value — for months heavy in Wanasa redemptions
        // the cash-revenue bar stays low while the nominal bar reflects
        // the true business volume delivered.
        _sum: { totalPrice: true, commissionAmount: true, pointsDiscount: true, couponDiscount: true },
      });
      const revenue = Number(result._sum.totalPrice ?? 0) - Number(result._sum.commissionAmount ?? 0);
      // totalPrice carries the full vendor-earned amount for every booking
      // including Wanasa-paid ones, so we don't add pointsDiscount here —
      // it would double-count. couponDiscount IS added because the coupon
      // is a vendor-absorbed reduction, so reconstructing gross adds it back.
      const bookingsValue = Number(result._sum.totalPrice ?? 0) + Number(result._sum.couponDiscount ?? 0);
      const wanasaFundedValue = Number(result._sum.pointsDiscount ?? 0);
      months.push({
        month: start.toLocaleDateString('en-US', { month: 'short', year: '2-digit' } as any),
        revenue,
        bookingsValue,
        wanasaFundedValue,
      });
    }
    return months;
  }

  async createCoupon(userId: string, body: { code: string; discountType: 'PERCENTAGE' | 'FIXED'; discountValue: number; validFrom: string; validTo: string; usageLimit?: number; minOrderAmount?: number; maxDiscount?: number; activityIds?: string[] }) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;

    // Normalise to UPPERCASE — every redeem/validate path (validateCoupon +
    // createBooking) looks the code up uppercased, so a lowercase code stored
    // verbatim would be permanently unredeemable. Admin createCoupon already
    // does this; match it here.
    const code = body.code.toUpperCase().trim();
    const existing = await db.coupon.findUnique({ where: { code } });
    if (existing) throw new ConflictException('Coupon code already exists');

    // Activity scoping (Bug A): a non-empty list restricts the coupon to those
    // activities; empty = applies to all of the vendor's activities. Verify the
    // ids are all THIS vendor's — a vendor must not scope a coupon to another
    // vendor's activity (defence; it would never match anyway).
    const activityIds = body.activityIds ?? [];
    if (activityIds.length > 0) {
      const owned = await db.activity.count({ where: { id: { in: activityIds }, vendorId: vendor.id } });
      if (owned !== activityIds.length) {
        throw new BadRequestException('Applicable activities must all belong to you.');
      }
    }

    // Whole-day UTC validity bounds (END-of-day validTo) — same reason as the
    // admin path: a bare-midnight validTo expires the coupon at 00:00 of the
    // expiry day, so it never matches `validTo > now` at checkout / listing.
    const validFrom = new Date(`${String(body.validFrom).slice(0, 10)}T00:00:00.000Z`);
    const validTo = new Date(`${String(body.validTo).slice(0, 10)}T23:59:59.999Z`);
    if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime())) {
      throw new BadRequestException('Invalid validity dates');
    }
    if (validTo <= validFrom) {
      throw new BadRequestException('Expiry date must be after the start date');
    }

    return db.coupon.create({
      data: {
        code,
        vendorId: vendor.id,
        applicableActivityIds: activityIds,
        discountType: body.discountType,
        discountValue: body.discountValue,
        validFrom,
        validTo,
        usageLimit: body.usageLimit ? Number(body.usageLimit) : null,
        minOrderAmount: body.minOrderAmount || null,
        maxDiscount: body.maxDiscount || null,
        status: 'PENDING',
      },
    });
  }

  // ─── Payout Requests ─────────────────────────────────────
  async getPayoutRequests(userId: string, query: VendorPaginationDto) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const [requests, total] = await Promise.all([
      db.payoutRequest.findMany({
        where: { vendorId: vendor.id },
        // Explicit select — DO NOT add adminNote or paymentIds here. adminNote
        // is internal admin commentary (e.g., "vendor flagged for slow
        // response — investigate before next payout"); paymentIds reveals the
        // exact payment rows the platform considered eligible at approval
        // time, which is platform-internal accounting state. Both stay on
        // the admin side. If a future feature wants to surface a rejection
        // reason to the vendor, copy it into a customer-safe `vendorMessage`
        // field rather than exposing adminNote directly.
        select: {
          id: true,
          vendorId: true,
          amount: true,
          currency: true,
          status: true,
          processedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.payoutRequest.count({ where: { vendorId: vendor.id } }),
    ]);

    return { data: requests, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Shared eligibility check — the single source of truth for whether a
   * vendor can submit a payout request right now. Both the GET earnings
   * endpoint and the POST request endpoint call this so the UI can display
   * the *exact* reason the request button is disabled without first
   * having to try-and-fail.
   *
   * Returns a discriminated object:
   *   { ok: true,  available, currency }        → request will succeed
   *   { ok: false, code, message, ... }         → surfaces the blocker
   *
   * Codes:
   *   VENDOR_SUSPENDED   — vendor account suspended
   *   INFLIGHT_PENDING   — one request already waiting for admin decision
   *   INFLIGHT_APPROVED  — request approved, awaiting bank transfer
   *   NO_BANK_DETAILS    — vendor has not configured bank account
   *   NO_BALANCE         — all eligible payments already paid out
   *   BELOW_MINIMUM      — balance > 0 but under minimum payout threshold
   *   BANK_DETAILS_RECENTLY_CHANGED — bankDetails edited within cool-down window
   */
  private async evaluatePayoutEligibility(vendorId: string): Promise<
    | { ok: true; available: number; currency: string; minimum: number }
    | { ok: false; code: string; message: string; available: number; currency: string; minimum: number }
  > {
    const db = this.prisma.client;

    // Defence-in-depth: even though resolveVendor() already blocks suspended
    // vendors, re-check inside eligibility so GET /earnings/eligibility can
    // surface the reason to the UI without throwing.
    const vendorRow = await db.vendor.findUnique({
      where: { id: vendorId },
      select: {
        status: true,
        bankDetails: true,
        bankDetailsChangedAt: true,
        country: { select: { currencyCode: true } },
      },
    });
    const currency = vendorRow?.country?.currencyCode ?? 'QAR';
    // Minimum request threshold — env-configurable so it can be tuned per
    // market without a code deploy. Prevents vendors spamming micro-requests
    // that cost more to process than they're worth.
    const minimum = Math.max(0, Number(process.env.MIN_PAYOUT_AMOUNT || 10));

    if (!vendorRow || vendorRow.status === 'SUSPENDED') {
      return { ok: false, code: 'VENDOR_SUSPENDED', message: 'Your vendor account is suspended. Contact support.', available: 0, currency, minimum };
    }

    // Order of checks is deliberate: cheapest DB hits first, and preconditions
    // the vendor can FIX themselves (bank details) surface before balance-based
    // blockers (which depend on customer activity).
    const inflight = await db.payoutRequest.findFirst({
      where: { vendorId, status: { in: ['PENDING', 'APPROVED'] } },
      select: { id: true, status: true },
    });
    if (inflight) {
      return inflight.status === 'PENDING'
        ? { ok: false, code: 'INFLIGHT_PENDING',  message: 'You already have a pending payout request. Wait for admin review before requesting another.', available: 0, currency, minimum }
        : { ok: false, code: 'INFLIGHT_APPROVED', message: 'Your previous request has been approved and is awaiting bank transfer. A new request will unlock once it completes.', available: 0, currency, minimum };
    }

    if (!vendorRow.bankDetails) {
      return { ok: false, code: 'NO_BANK_DETAILS', message: 'Add your bank details in Settings before requesting a payout.', available: 0, currency, minimum };
    }

    // Bank-details cool-down — closes the "vendor account compromise →
    // change bank details → instant payout to attacker" window. If the
    // vendor edited bankDetails within the configured cool-down (default
    // 7 days, env PAYOUT_BANK_DETAILS_COOLDOWN_DAYS), block payout
    // requests until the window passes. Existing vendors who never
    // touched the field since the column landed have NULL, which is
    // treated as "no recent change" — correct behaviour.
    // NaN-safe parse: a malformed env value (`"abc"`, `""`) used to silently
    // disable the cool-down because Number("abc") → NaN → `> 0` is false.
    // Now: only honour the env if it parses to a finite non-negative number;
    // otherwise fall back to the 7-day default. Setting the env explicitly
    // to `0` is still allowed (intentional disable for tests).
    const cooldownEnv = process.env.PAYOUT_BANK_DETAILS_COOLDOWN_DAYS;
    const cooldownParsed = cooldownEnv === undefined ? 7 : Number(cooldownEnv);
    const cooldownDays = Number.isFinite(cooldownParsed) && cooldownParsed >= 0 ? cooldownParsed : 7;
    if (cooldownDays > 0 && vendorRow.bankDetailsChangedAt) {
      const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
      const elapsedMs = Date.now() - vendorRow.bankDetailsChangedAt.getTime();
      if (elapsedMs < cooldownMs) {
        const remainingHours = Math.ceil((cooldownMs - elapsedMs) / (60 * 60 * 1000));
        return {
          ok: false,
          code: 'BANK_DETAILS_RECENTLY_CHANGED',
          message: `Bank details were updated recently. Payout requests are paused for ~${remainingHours}h as a security precaution.`,
          available: 0,
          currency,
          minimum,
        };
      }
    }

    // Exclude payments locked into an APPROVED/COMPLETED request — even if the
    // inflight guard above misses a race, this filter keeps payouts unique.
    const lockedRequests = await db.payoutRequest.findMany({
      where: { vendorId, status: { in: ['APPROVED', 'COMPLETED'] } },
      select: { paymentIds: true },
    });
    const lockedPaymentIds = lockedRequests.flatMap((r) => r.paymentIds ?? []);

    // Escrow: only pay out for activities that have already ENDED (+ an optional
    // settlement/dispute buffer via PAYOUT_SETTLEMENT_BUFFER_DAYS, default 0). A
    // customer cannot cancel once the activity has started, so gating payout on
    // endDatetime closes the "vendor gets paid, then the customer cancels a
    // still-future booking for a points refund" collusion vector — no cash
    // leaves while the booking is still reversible.
    const payoutBufferDays = Math.max(0, Number(process.env.PAYOUT_SETTLEMENT_BUFFER_DAYS || 0));
    const payoutCutoff = new Date(Date.now() - payoutBufferDays * 86_400_000);

    const agg = await db.booking.aggregate({
      where: {
        vendorId,
        endDatetime: { lt: payoutCutoff },
        payment: {
          status: 'SUCCESS',
          payoutStatus: 'UNPAID',
          ...(lockedPaymentIds.length > 0 ? { id: { notIn: lockedPaymentIds } } : {}),
        },
      },
      _sum: { totalPrice: true, commissionAmount: true },
    });
    const available = Math.max(
      0,
      Math.round((Number(agg._sum.totalPrice ?? 0) - Number(agg._sum.commissionAmount ?? 0)) * 100) / 100,
    );

    if (available <= 0) {
      return { ok: false, code: 'NO_BALANCE', message: 'No eligible cash pending. New bookings will appear here once customers pay.', available, currency, minimum };
    }
    if (available < minimum) {
      return { ok: false, code: 'BELOW_MINIMUM', message: `Eligible balance ${available.toFixed(2)} ${currency} is below the minimum payout of ${minimum.toFixed(2)} ${currency}. Keep delivering bookings — you'll unlock payout soon.`, available, currency, minimum };
    }

    return { ok: true, available, currency, minimum };
  }

  async getPayoutEligibility(userId: string) {
    const vendor = await this.resolveVendor(userId);
    return this.evaluatePayoutEligibility(vendor.id);
  }

  /**
   * Lets a vendor clear a REJECTED payout request from their history. Only
   * REJECTED is deletable — PENDING/APPROVED/COMPLETED represent active or
   * settled money movements and must stay immutable for auditing. Ownership
   * is enforced via the vendor lookup below so one vendor cannot delete
   * another's record even if they guess the id.
   */
  async deletePayoutRequest(userId: string, requestId: string) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;

    const req = await db.payoutRequest.findUnique({
      where: { id: requestId },
      select: { id: true, vendorId: true, status: true },
    });
    if (!req) throw new NotFoundException('Payout request not found');
    if (req.vendorId !== vendor.id) {
      // Don't leak whether the id exists for a different vendor. Respond
      // with the same 404 an unknown id would produce.
      throw new NotFoundException('Payout request not found');
    }
    if (req.status !== 'REJECTED') {
      throw new BadRequestException(
        `Only rejected payout requests can be cleared. This request is ${req.status.toLowerCase()}.`,
      );
    }

    // Race-safe delete: only delete if still REJECTED. If an admin somehow
    // re-opens or re-processes it in the gap, the deletion no-ops and we
    // tell the vendor to refresh instead of silently losing state.
    const result = await db.payoutRequest.deleteMany({
      where: { id: requestId, vendorId: vendor.id, status: 'REJECTED' },
    });
    if (result.count === 0) {
      throw new BadRequestException('Request state changed. Please refresh and try again.');
    }

    return { deleted: true, id: requestId };
  }

  async requestPayout(userId: string) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;

    const eligibility = await this.evaluatePayoutEligibility(vendor.id);
    if (!eligibility.ok) {
      // Structured payload so the frontend can branch on `code` and offer
      // the right CTA (e.g., "Add bank details" vs "Wait for admin").
      throw new BadRequestException({
        statusCode: 400,
        code: eligibility.code,
        message: eligibility.message,
      });
    }

    // Atomicity guard for the double-request race. evaluatePayoutEligibility()
    // already blocks when an inflight (PENDING/APPROVED) request exists, but that
    // check and this create are NOT atomic — two concurrent calls (double-click /
    // two tabs / a retried request) can both pass the check and each insert a
    // PENDING request for the same money, which an admin could then approve twice
    // (paying the vendor twice). Re-check + insert inside a SERIALIZABLE
    // transaction: for two truly-simultaneous requests Postgres aborts one with a
    // serialization failure (P2034); the in-tx re-check catches the slightly-later
    // one. Either way the loser gets the same friendly inflight error.
    const inflightError = () =>
      new BadRequestException({
        statusCode: 400,
        code: 'INFLIGHT_PENDING',
        message:
          'You already have a pending payout request. Wait for admin review before requesting another.',
      });

    const request = await db
      .$transaction(
        async (tx) => {
          const dup = await tx.payoutRequest.findFirst({
            where: { vendorId: vendor.id, status: { in: ['PENDING', 'APPROVED'] } },
            select: { id: true },
          });
          if (dup) throw inflightError();
          return tx.payoutRequest.create({
            data: {
              vendorId: vendor.id,
              amount: eligibility.available,
              currency: eligibility.currency,
              status: 'PENDING',
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch((err: unknown) => {
        // A concurrent insert makes Serializable abort the loser with P2034 —
        // surface it as the same friendly inflight error the re-check throws.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
          throw inflightError();
        }
        throw err;
      });

    this.notificationService.notifyAdmins({
      type: 'PAYOUT_REQUESTED',
      title: 'Payout Request',
      message: `Vendor ${vendor.businessNameEn} requested payout of ${eligibility.available.toFixed(2)}`,
      // Land admin directly on the Payout Requests tab so they see the
      // pending queue without an extra click.
      link: '/admin/payouts?tab=requests',
    });

    return request;
  }

  // ─── Per-Activity Analytics ──────────────────────────────
  async getActivityAnalytics(userId: string) {
    const vendor = await this.resolveVendor(userId);
    const db = this.prisma.client;

    const activities = await db.activity.findMany({
      where: { vendorId: vendor.id },
      select: {
        id: true,
        titleEn: true,
        status: true,
        pricePerPerson: true,
        _count: {
          select: {
            // Cancelled bookings no longer exist for business-metric
            // purposes (activity tiles, dashboard, analytics). Stay in
            // lock-step with the SUCCESS-payment filter used in revenue
            // aggregates so counts and revenue reconcile.
            bookings: { where: { status: { not: 'CANCELLED' } } },
            reviews: true,
            likes: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get revenue per activity. Aggregates totalPrice (cash-to-vendor) plus
    // pointsDiscount/couponDiscount so per-activity analytics can surface
    // both cash revenue AND nominal bookings value (critical for activities
    // that attract a lot of Wanasa-funded bookings — cash revenue alone
    // would read as 0 and misrepresent the activity's performance).
    const activityIds = activities.map(a => a.id);
    const revenueData = activityIds.length > 0
      ? await db.booking.groupBy({
          by: ['activityId'],
          where: {
            activityId: { in: activityIds },
            payment: { status: 'SUCCESS' },
          },
          _sum: { totalPrice: true, commissionAmount: true, pointsDiscount: true, couponDiscount: true },
        })
      : [];

    const revenueMap = new Map(revenueData.map(r => [
      r.activityId,
      {
        revenue: Number(r._sum.totalPrice ?? 0) - Number(r._sum.commissionAmount ?? 0),
        // See note in getEarnings: totalPrice now includes Wanasa-paid
        // value too, so bookingsValue = totalPrice + couponDiscount.
        // pointsDiscount is audit-only and not additive.
        bookingsValue: Number(r._sum.totalPrice ?? 0) + Number(r._sum.couponDiscount ?? 0),
        wanasaFundedValue: Number(r._sum.pointsDiscount ?? 0),
      },
    ]));

    // Get average rating per activity
    const ratingData = activityIds.length > 0
      ? await db.review.groupBy({
          by: ['activityId'],
          where: { activityId: { in: activityIds } },
          _avg: { rating: true },
        })
      : [];

    const ratingMap = new Map(ratingData.map(r => [r.activityId, r._avg.rating ?? 0]));

    return activities.map(a => {
      const m = revenueMap.get(a.id);
      return {
        id: a.id,
        titleEn: a.titleEn,
        status: a.status,
        price: Number(a.pricePerPerson),
        bookings: a._count.bookings,
        reviews: a._count.reviews,
        likes: a._count.likes,
        revenue: m?.revenue ?? 0,
        bookingsValue: m?.bookingsValue ?? 0,
        wanasaFundedValue: m?.wanasaFundedValue ?? 0,
        avgRating: Number((ratingMap.get(a.id) ?? 0).toFixed(1)),
      };
    });
  }
}
