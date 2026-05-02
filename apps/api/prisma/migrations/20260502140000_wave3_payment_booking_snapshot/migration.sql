-- Wave 3 of business-logic remediation (plan §B2).
--
-- Adds two columns to `payments`:
--   • bookingSnapshot     — server-derived Json copy of the booking row,
--                           frozen at booking-creation time. Never sourced
--                           from request body, never updateable. Used by
--                           the PAY2M callback's orphan-recovery branch
--                           when the cleanup cron deleted the booking
--                           before the success callback arrived.
--   • bookingRecreatedAt  — idempotency marker. Set inside the same tx
--                           that recreates the booking, so a replayed
--                           callback can't insert a second copy.
--
-- Both nullable to keep the migration backwards-compatible: existing
-- payments don't have a snapshot (their bookings already exist). New
-- payments will get the snapshot populated in createBooking.

ALTER TABLE "payments"
  ADD COLUMN "bookingSnapshot" JSONB,
  ADD COLUMN "bookingRecreatedAt" TIMESTAMP(3);
