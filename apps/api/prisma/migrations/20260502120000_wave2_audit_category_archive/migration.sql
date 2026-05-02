-- Wave 2 of business-logic remediation (plan §B7 + §B8)
--
-- Adds:
--   1. AuditActionCategory enum with values FINANCIAL / OPERATIONAL
--   2. audit_logs.actionCategory column, default OPERATIONAL
--   3. audit_logs.archivedAt column (nullable, soft-delete marker)
--   4. Two supporting indexes
--
-- Together with the cleanup-cron change (cleanup.service.ts), this
-- gives FINANCIAL audit entries 7-year retention via soft-delete
-- (UPDATE archivedAt = now()), and OPERATIONAL entries the existing
-- RETENTION_AUDIT_LOG_DAYS window — but never DELETE rows physically.
-- Closes the regulatory gap from Qatar PDPL §14 + GDPR Art.30 +
-- standard financial-records retention.
--
-- All changes additive: existing rows backfill to OPERATIONAL +
-- archivedAt NULL, which preserves prior behavior for any code path
-- that hasn't been updated to read these fields yet.

CREATE TYPE "AuditActionCategory" AS ENUM ('FINANCIAL', 'OPERATIONAL');

ALTER TABLE "audit_logs"
  ADD COLUMN "actionCategory" "AuditActionCategory" NOT NULL DEFAULT 'OPERATIONAL',
  ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "audit_logs_actionCategory_createdAt_idx"
  ON "audit_logs"("actionCategory", "createdAt");

CREATE INDEX "audit_logs_archivedAt_idx"
  ON "audit_logs"("archivedAt");
