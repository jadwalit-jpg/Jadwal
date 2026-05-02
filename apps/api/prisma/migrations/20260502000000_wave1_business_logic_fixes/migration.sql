-- Wave 1 of business-logic remediation (plan §B3 + §B4)
--
-- 1. Add LoyaltyLedgerSource value CANCEL_REVERSE_AWARDED so the cancel
--    paths can debit points that were earned on COMPLETED bookings when
--    those bookings are subsequently cancelled by admin/vendor — closes
--    the "earn 100 points then cancel and keep them" double-dip.
--
-- 2. Add Vendor.bankDetailsChangedAt so evaluatePayoutEligibility() can
--    enforce a cool-down (default 7 days, env PAYOUT_BANK_DETAILS_COOLDOWN_DAYS)
--    between a bank-details change and the next allowed payout request.
--    Closes the "compromised vendor account → instant payout to attacker
--    bank" attack window.
--
-- Both changes are additive (new enum value + nullable column with no
-- default backfill), safe under prisma migrate deploy on existing data.

ALTER TYPE "LoyaltyLedgerSource" ADD VALUE 'CANCEL_REVERSE_AWARDED' AFTER 'CANCEL_REFUND_PAID';

ALTER TABLE "vendors" ADD COLUMN "bankDetailsChangedAt" TIMESTAMP(3);
