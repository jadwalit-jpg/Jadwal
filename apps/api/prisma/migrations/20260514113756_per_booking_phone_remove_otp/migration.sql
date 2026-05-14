-- Per-booking phone + OTP machinery removal.
--
-- 1) Add Booking.bookingPhone (required). User confirmed prod is empty;
--    we still add with DEFAULT '' for dev DBs that may have rows.
-- 2) Drop the default after the add so future inserts MUST supply a value
--    (the createBooking DTO @IsNotEmpty enforces it at the API edge).
-- 3) Add an index for vendor/admin phone-lookup queries.
-- 4) Drop the User phone-OTP columns (phoneVerified, phoneOtpHash,
--    phoneOtpExpiry, phoneOtpAttempts). KEEP User.phone — still used as a
--    pre-fill source for the booking modal + editable in profile.

ALTER TABLE "bookings"
  ADD COLUMN "bookingPhone" VARCHAR(20) NOT NULL DEFAULT '';

-- Backfill is a no-op in prod (zero bookings). Drop the default so
-- application code MUST provide a value going forward.
ALTER TABLE "bookings"
  ALTER COLUMN "bookingPhone" DROP DEFAULT;

CREATE INDEX "bookings_bookingPhone_idx" ON "bookings"("bookingPhone");

-- Drop OTP columns from users.
ALTER TABLE "users" DROP COLUMN IF EXISTS "phoneVerified";
ALTER TABLE "users" DROP COLUMN IF EXISTS "phoneOtpHash";
ALTER TABLE "users" DROP COLUMN IF EXISTS "phoneOtpExpiry";
ALTER TABLE "users" DROP COLUMN IF EXISTS "phoneOtpAttempts";
