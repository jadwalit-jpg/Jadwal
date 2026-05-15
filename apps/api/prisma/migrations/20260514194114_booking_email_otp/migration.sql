-- Email-OTP verification gate between booking creation and PAY2M handoff.
--
-- Adds four nullable columns to bookings:
--   emailOtpHash       — SHA-256 hex digest (64 chars) of the 6-digit code
--   emailOtpExpiry     — 10 minutes from issue
--   emailOtpAttempts   — verify-attempt counter; capped at 5 in code
--   emailOtpVerifiedAt — one-way; set on successful verify, never reset
--
-- Existing PENDING bookings (dev rows only — prod has none) will have NULL
-- for all four. Frontend treats NULL emailOtpVerifiedAt as "needs OTP".
-- payment.initiate is gated on emailOtpVerifiedAt; PAY2M token cannot be
-- issued until the customer verifies the code that was emailed at booking-
-- create time.

ALTER TABLE "bookings"
  ADD COLUMN "emailOtpHash" VARCHAR(64),
  ADD COLUMN "emailOtpExpiry" TIMESTAMP(3),
  ADD COLUMN "emailOtpAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "emailOtpVerifiedAt" TIMESTAMP(3);

-- Index supports: cleanup-cron sweeps over expiring unverified bookings,
-- and forensic lookup of a single customer's verification state across
-- their recent bookings.
CREATE INDEX "bookings_customerId_emailOtpExpiry_idx"
  ON "bookings"("customerId", "emailOtpExpiry");
