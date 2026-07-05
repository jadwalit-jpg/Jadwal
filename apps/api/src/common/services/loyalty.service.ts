import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma, LoyaltyLedgerSource, LoyaltyActorType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

export interface RedeemArgs {
  userId: string;
  amount: number;           // positive number of points to deduct
  bookingId: string;
  note: string;             // short human note for the ledger row
}

export interface RefundArgs {
  userId: string;
  amount: number;           // positive number of points to credit
  bookingId: string;
  source: Extract<
    LoyaltyLedgerSource,
    | 'CANCEL_REFUND_UNPAID'
    | 'CANCEL_REFUND_PAID'
    | 'VENDOR_REFUND_APPROVED'
    | 'ADMIN_REFUND_APPROVED'
  >;
  actorType: LoyaltyActorType;
  actorId?: string | null;
  note: string;
}

export interface EarnArgs {
  userId: string;
  amount: number;           // positive
  bookingId: string;
  note: string;
}

export interface ReverseAwardedArgs {
  userId: string;
  amount: number;           // positive number of points to debit (the award amount)
  bookingId: string;
  actorType: LoyaltyActorType;
  actorId?: string | null;
  note: string;
}

export interface AdjustArgs {
  userId: string;
  delta: number;            // positive or negative; never zero
  actorType: Extract<LoyaltyActorType, 'ADMIN'>;
  actorId: string;
  reason: string;
}

/**
 * Single source of truth for every change to User.loyaltyPoints.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS SERVICE EXISTS
 * ──────────────────────────────────────────────────────────────────────────
 * 1. ATOMICITY — Before this service, the redeem path did
 *    `read balance → check → decrement`. Two parallel requests could both
 *    pass the check against a stale balance and go negative. We now use
 *    conditional `updateMany WHERE loyaltyPoints >= amount` + count check.
 *    No TOCTOU window.
 *
 * 2. LEDGER — Every change writes a `LoyaltyLedger` row in the SAME
 *    transaction. The ledger is append-only and authoritative — if
 *    `user.loyaltyPoints` ever drifts from `sum(delta)` for that user,
 *    the ledger wins and the balance is corrected via a SYSTEM_CORRECTION
 *    row (not done here — that's a forensic procedure).
 *
 * 3. DEDUPLICATION — Every refund/earn path in the codebase used to do
 *    its own `loyaltyPoints: { increment }`. Four copies drift over time.
 *    All paths now call this service; one place to audit, one place to
 *    change the rules.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CONTRACT — every method MUST be called with an existing `tx` so the
 * balance update and ledger write land atomically. There is no non-tx
 * variant on purpose.
 * ──────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class LoyaltyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Deduct points from a user at booking time. Atomic: either the balance
   * has ≥ amount and both rows update, or no change and we throw 409.
   */
  async redeem(tx: Tx, args: RedeemArgs): Promise<{ balanceAfter: number }> {
    const amount = this.round2(args.amount);
    this.assertPositive(amount, 'amount');

    // Conditional updateMany — only decrements if current balance ≥ amount.
    // `count: 0` means the guard failed → insufficient funds.
    const updated = await tx.user.updateMany({
      where: { id: args.userId, loyaltyPoints: { gte: amount } },
      data: { loyaltyPoints: { decrement: amount } },
    });
    if (updated.count === 0) {
      // Either the user doesn't exist or balance < amount. We return the
      // same generic message either way — don't leak account state.
      throw new ConflictException('Insufficient loyalty points');
    }

    const user = await tx.user.findUniqueOrThrow({
      where: { id: args.userId },
      select: { loyaltyPoints: true },
    });

    await this.writeLedger(tx, {
      userId: args.userId,
      delta: -amount,
      balanceAfter: this.toNum(user.loyaltyPoints),
      source: 'BOOKING_REDEEM',
      bookingId: args.bookingId,
      actorType: 'CUSTOMER',
      actorId: args.userId,
      reason: args.note,
    });

    return { balanceAfter: this.toNum(user.loyaltyPoints) };
  }

  /**
   * Credit points back to a user — used by cancel / refund paths.
   * Guaranteed idempotent-within-a-transaction: caller is responsible for
   * only calling it once per refund event (cancelBooking already guards
   * against double-cancel).
   */
  async refund(tx: Tx, args: RefundArgs): Promise<{ balanceAfter: number }> {
    const amount = this.round2(args.amount);
    this.assertPositive(amount, 'amount');

    const user = await tx.user.update({
      where: { id: args.userId },
      data: { loyaltyPoints: { increment: amount } },
      select: { loyaltyPoints: true },
    });

    await this.writeLedger(tx, {
      userId: args.userId,
      delta: amount,
      balanceAfter: this.toNum(user.loyaltyPoints),
      source: args.source,
      bookingId: args.bookingId,
      actorType: args.actorType,
      actorId: args.actorId ?? null,
      reason: args.note,
    });

    return { balanceAfter: this.toNum(user.loyaltyPoints) };
  }

  /**
   * Award points when a booking completes (earn rate × totalPrice).
   * Called from cleanup cron and admin/vendor status-completion paths.
   */
  async earn(tx: Tx, args: EarnArgs): Promise<{ balanceAfter: number }> {
    const amount = this.round2(args.amount);
    this.assertPositive(amount, 'amount');

    const user = await tx.user.update({
      where: { id: args.userId },
      data: { loyaltyPoints: { increment: amount } },
      select: { loyaltyPoints: true },
    });

    await this.writeLedger(tx, {
      userId: args.userId,
      delta: amount,
      balanceAfter: this.toNum(user.loyaltyPoints),
      source: 'BOOKING_EARN',
      bookingId: args.bookingId,
      actorType: 'SYSTEM',
      actorId: null,
      reason: args.note,
    });

    return { balanceAfter: this.toNum(user.loyaltyPoints) };
  }

  /**
   * Points earned on a completed booking. SINGLE SOURCE OF TRUTH for the earn
   * amount — every award AND reverse site computes through here so the
   * cancel-debit always equals the earn-credit.
   *
   * The earn rate applies ONLY to the cash value the customer actually paid:
   * the Wanasa-points-redeemed portion earns NOTHING. Otherwise paying fully
   * with points would mint the same points straight back — an infinite-points
   * loop (book free → earn enough to book again). Redemption is binary (cover
   * the whole activity or none), so a points-paid booking has
   * `pointsDiscount == totalPrice` → 0 earned, and a cash booking has
   * `pointsDiscount == 0` → earns on the full price (unchanged behaviour).
   */
  computeEarnedPoints(totalPrice: number, pointsDiscount: number, pointsPerQar: number): number {
    if (pointsPerQar <= 0) return 0;
    const cashBasis = Math.max(0, totalPrice - pointsDiscount);
    // Points are QAR-denominated (1 point = 1 QAR), so the 1% earn keeps its
    // fractional value rounded to 2 dp — NOT floored. 90 QAR × 0.01 = 0.90 pt,
    // 100 → 1.00, 250 → 2.50. round2 also absorbs float dust (90 * 0.01 in JS
    // is 0.8999999999999999).
    return this.round2(cashBasis * pointsPerQar);
  }

  /**
   * Debit points that were previously earned (BOOKING_EARN) when the
   * booking is later cancelled. Used by admin/vendor cancel paths in
   * bookings.service.ts when `booking.pointsAwarded === true`. Closes
   * the "earn 100 points then cancel and keep them" double-dip.
   *
   * Behaviour mirrors `adjust()` for the clamp: if the user's current
   * balance is lower than the awarded amount (because they spent the
   * points elsewhere), we debit only what's available rather than
   * driving the balance negative. The ledger reason captures the
   * clamp for reconciliation.
   */
  async reverseAwarded(tx: Tx, args: ReverseAwardedArgs): Promise<{ balanceAfter: number; appliedDelta: number }> {
    const requestedDebit = this.round2(args.amount);
    this.assertPositive(requestedDebit, 'amount');

    const current = await tx.user.findUniqueOrThrow({
      where: { id: args.userId },
      select: { loyaltyPoints: true },
    });

    // Negative delta — clamp magnitude to current balance so the row
    // never drives the balance below zero (balance constraint at
    // user.loyaltyPoints column would otherwise reject the update).
    const currentBalance = this.toNum(current.loyaltyPoints);
    const actualDebit = this.round2(Math.min(requestedDebit, currentBalance));
    const appliedDelta = -actualDebit;

    const clampNote =
      actualDebit !== requestedDebit
        ? ` (clamped from -${requestedDebit} — balance was ${currentBalance})`
        : '';

    const user = await tx.user.update({
      where: { id: args.userId },
      data: { loyaltyPoints: { increment: appliedDelta } },
      select: { loyaltyPoints: true },
    });

    await this.writeLedger(tx, {
      userId: args.userId,
      delta: appliedDelta,
      balanceAfter: this.toNum(user.loyaltyPoints),
      source: 'CANCEL_REVERSE_AWARDED',
      bookingId: args.bookingId,
      actorType: args.actorType,
      actorId: args.actorId ?? null,
      reason: `${args.note}${clampNote}`,
    });

    return { balanceAfter: this.toNum(user.loyaltyPoints), appliedDelta };
  }

  /**
   * Admin manual adjustment. Delta can be negative. Cannot drive balance
   * below zero — when subtracting, we clamp the effective delta to the
   * current balance so the ledger row matches the actual change.
   */
  async adjust(tx: Tx, args: AdjustArgs): Promise<{ balanceAfter: number; appliedDelta: number }> {
    const delta = this.round2(args.delta);
    if (delta === 0) {
      throw new BadRequestException('Adjustment delta must be non-zero');
    }

    // Load current balance first (inside the same tx; the final update is
    // still atomic because Prisma serialises the tx).
    const current = await tx.user.findUniqueOrThrow({
      where: { id: args.userId },
      select: { loyaltyPoints: true },
    });

    // Clamp negative deltas so balance never goes below zero.
    const currentBalance = this.toNum(current.loyaltyPoints);
    const appliedDelta =
      delta < 0 ? -this.round2(Math.min(-delta, currentBalance)) : delta;

    // If the admin asked to deduct 500 but the user only has 100, we
    // actually deducted 100 — the ledger reason notes the clamp so
    // reconciliation shows the intent vs. the applied change.
    const clampNote =
      appliedDelta !== delta
        ? ` (clamped from ${delta} — balance was ${currentBalance})`
        : '';

    const user = await tx.user.update({
      where: { id: args.userId },
      data: { loyaltyPoints: { increment: appliedDelta } },
      select: { loyaltyPoints: true },
    });

    await this.writeLedger(tx, {
      userId: args.userId,
      delta: appliedDelta,
      balanceAfter: this.toNum(user.loyaltyPoints),
      source: 'ADMIN_ADJUST',
      bookingId: null,
      actorType: args.actorType,
      actorId: args.actorId,
      reason: `${args.reason}${clampNote}`,
    });

    return { balanceAfter: this.toNum(user.loyaltyPoints), appliedDelta };
  }

  // ───────────────────────────── helpers ─────────────────────────────

  /**
   * Round to 2 decimals (QAR precision). Points are QAR-denominated, so every
   * balance/delta is money and must be exactly 2 dp — this also absorbs binary
   * float dust (e.g. 90 * 0.01 === 0.8999999999999999 in JS → 0.90).
   */
  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /** Prisma returns Decimal columns as Prisma.Decimal; normalise to a JS number. */
  private toNum(value: Prisma.Decimal | number): number {
    return typeof value === 'number' ? value : value.toNumber();
  }

  private assertPositive(value: number, field: string) {
    // Points are QAR-denominated to 2 dp, so fractional amounts (e.g. 0.90) are
    // valid — only reject non-finite or non-positive values.
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new BadRequestException(`${field} must be a positive amount`);
    }
  }

  private async writeLedger(
    tx: Tx,
    row: {
      userId: string;
      delta: number;
      balanceAfter: number;
      source: LoyaltyLedgerSource;
      bookingId: string | null;
      actorType: LoyaltyActorType;
      actorId: string | null;
      reason: string;
    },
  ) {
    if (row.delta === 0) {
      // Ledger rows must represent real changes — never write a zero delta.
      throw new BadRequestException('Ledger delta must be non-zero');
    }
    // Keep reason bounded so a misbehaving caller can't fill the ledger
    // with megabytes of text. Truncated to the DB's VarChar(500) cap.
    const reason = row.reason.length > 500 ? row.reason.slice(0, 500) : row.reason;

    await tx.loyaltyLedger.create({
      data: {
        userId: row.userId,
        delta: row.delta,
        balanceAfter: row.balanceAfter,
        source: row.source,
        bookingId: row.bookingId,
        actorType: row.actorType,
        actorId: row.actorId,
        reason,
      },
    });
  }
}
