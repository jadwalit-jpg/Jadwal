-- Wave 2 of business-logic remediation (plan §B10)
--
-- Adds reconciliation_logs table — daily snapshot of platform-wide
-- money flow, used by ReconciliationService cron to detect drift
-- between SUM(payments-success) vs SUM(vendor-earnings) +
-- SUM(platform-fees) + SUM(refunded). If the cron sees |drift|
-- > 0.01 QAR it logs `passed = false` and fires an admin alert.
--
-- One row per day. The trend chart on /admin can then show "today's
-- drift" and a 30-day streak.

CREATE TABLE "reconciliation_logs" (
  "id"              TEXT NOT NULL,
  "runDate"         TIMESTAMP(3) NOT NULL,
  "totalPayments"   DECIMAL(14, 2) NOT NULL,
  "vendorEarnings"  DECIMAL(14, 2) NOT NULL,
  "platformFees"    DECIMAL(14, 2) NOT NULL,
  "totalRefunded"   DECIMAL(14, 2) NOT NULL,
  "drift"           DECIMAL(14, 2) NOT NULL,
  "passed"          BOOLEAN NOT NULL DEFAULT false,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reconciliation_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reconciliation_logs_runDate_key"
  ON "reconciliation_logs"("runDate");

CREATE INDEX "reconciliation_logs_runDate_idx"
  ON "reconciliation_logs"("runDate");

CREATE INDEX "reconciliation_logs_passed_runDate_idx"
  ON "reconciliation_logs"("passed", "runDate");
