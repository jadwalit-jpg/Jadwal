-- Loyalty redenomination: Wanasa points are now denominated in QAR (1 point = 1 QAR).
--
--   Before: 100 points = 1 QAR. Earn pointsPerQar = 1.0 (100 QAR -> 100 pts),
--           redeem qarPerPoint = 0.01 (100 pts -> 1 QAR). Balances were Int.
--   After:  1 point = 1 QAR. Earn pointsPerQar = 0.01 (= 1% of cash paid, so
--           100 QAR -> 1.00 pt, 90 QAR -> 0.90 pt), redeem qarPerPoint = 1.0.
--           Balances are Decimal(12,2) so the 1% earn lands with no rounding loss.
--
-- Existing balances are divided by 100 so each customer's QAR VALUE is PRESERVED
-- (not multiplied 100x): e.g. a balance of 10 pts (= 0.10 QAR under the old rate)
-- becomes 0.10 pts (= 0.10 QAR under the new rate); 15 -> 0.15. Because every
-- stored value is an integer, `/100` is exact to 2 dp, so no rounding error is
-- introduced and the ledger (delta + balanceAfter snapshots) stays consistent.

-- users.loyaltyPoints: Int -> NUMERIC(12,2), value /100 to preserve QAR worth.
ALTER TABLE "users" ALTER COLUMN "loyaltyPoints" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "loyaltyPoints" TYPE DECIMAL(12,2) USING ROUND("loyaltyPoints"::numeric / 100, 2);
ALTER TABLE "users" ALTER COLUMN "loyaltyPoints" SET DEFAULT 0;

-- loyalty_ledger: Int -> NUMERIC(12,2), same /100 redenomination for delta + snapshot.
ALTER TABLE "loyalty_ledger" ALTER COLUMN "delta" TYPE DECIMAL(12,2) USING ROUND("delta"::numeric / 100, 2);
ALTER TABLE "loyalty_ledger" ALTER COLUMN "balanceAfter" TYPE DECIMAL(12,2) USING ROUND("balanceAfter"::numeric / 100, 2);

-- bookings.pointsRedeemed (the point COUNT redeemed on a booking): Int -> NUMERIC(10,2),
-- /100 so it stays equal to the booking's pointsDiscount QAR value (1 pt = 1 QAR).
ALTER TABLE "bookings" ALTER COLUMN "pointsRedeemed" DROP DEFAULT;
ALTER TABLE "bookings" ALTER COLUMN "pointsRedeemed" TYPE DECIMAL(10,2) USING ROUND("pointsRedeemed"::numeric / 100, 2);
ALTER TABLE "bookings" ALTER COLUMN "pointsRedeemed" SET DEFAULT 0;

-- loyalty_config: flip the live singleton row FIRST (atomic with the type change
-- above so there is no window where a Decimal balance meets the old rate), then
-- update the column defaults so fresh installs match the new model.
UPDATE "loyalty_config" SET "pointsPerQar" = 0.01, "qarPerPoint" = 1.0, "minRedemption" = 1 WHERE "id" = 'singleton';
ALTER TABLE "loyalty_config" ALTER COLUMN "pointsPerQar" SET DEFAULT 0.01;
ALTER TABLE "loyalty_config" ALTER COLUMN "qarPerPoint" SET DEFAULT 1.0;
ALTER TABLE "loyalty_config" ALTER COLUMN "minRedemption" SET DEFAULT 1;
