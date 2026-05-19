-- AlterTable
-- Additive: nullable column, no default, no data loss.
ALTER TABLE "users" ADD COLUMN "bookingOtpVerifiedAt" TIMESTAMP(3);

-- Backfill: users who already cleared a booking OTP keep their exemption, so
-- existing verified customers aren't asked to re-verify. Idempotent one-shot:
-- the column starts NULL everywhere, so this UPDATE only ever fires on the
-- rows it has not yet touched.
UPDATE "users" u
SET "bookingOtpVerifiedAt" = sub.first_verified
FROM (
  SELECT "customerId", MIN("emailOtpVerifiedAt") AS first_verified
  FROM "bookings"
  WHERE "emailOtpVerifiedAt" IS NOT NULL
  GROUP BY "customerId"
) sub
WHERE u."id" = sub."customerId";
