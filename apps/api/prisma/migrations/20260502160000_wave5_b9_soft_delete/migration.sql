-- Wave 5 of business-logic remediation (plan §B9).
--
-- Adds `deletedAt` soft-delete columns to `users`, `vendors`, `activities`.
-- Booking / Payment / LoyaltyLedger / Review rows stay hard-keyed to the
-- soft-deleted row so the 7-year financial-record audit trail survives
-- any "delete this user / vendor" admin action — Qatar PDPL §14, GDPR
-- Art.30, and standard tax-records retention.
--
-- Rationale:
--   • PDPL right-to-be-forgotten satisfied via PII anonymisation
--     (email/fullName/phone/passwordHash nulled out) — performed in the
--     application service, not the DB.
--   • Tax / financial reconciliation satisfied because Booking + Payment
--     rows are NEVER deleted on user/vendor delete.
--   • Forensic / fraud investigation: every old booking remains queryable;
--     it just shows "Deleted User" in place of the customer's name.
--   • Re-registration UX: User.email is reassigned to
--     `<userId>@deleted.local` so the original address is freed; same
--     for Vendor.slug (→ `deleted-<vendorId>`) and Activity.slug
--     (→ `deleted-<activityId>`).
--
-- Indexes on `deletedAt` keep the "active rows only" filter cheap.

ALTER TABLE "users"      ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "vendors"    ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "activities" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "users_deletedAt_idx"      ON "users"      ("deletedAt");
CREATE INDEX "vendors_deletedAt_idx"    ON "vendors"    ("deletedAt");
CREATE INDEX "activities_deletedAt_idx" ON "activities" ("deletedAt");
