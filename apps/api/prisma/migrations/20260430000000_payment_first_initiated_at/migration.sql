-- Add paymentFirstInitiatedAt: an immutable timestamp set on the first
-- /payment/initiate call. The cleanup cron now uses this column for the
-- gateway-abandonment cutoff so a customer cannot indefinitely extend
-- their PENDING reservation by re-initiating payment from a stale tab.
-- The existing paymentInitiatedAt column stays — it's still re-stamped on
-- each retry for forensics ("when did they last try to pay?").

ALTER TABLE "payments" ADD COLUMN "paymentFirstInitiatedAt" TIMESTAMP(3);

-- Backfill: for any existing payments where paymentInitiatedAt is set,
-- copy that into paymentFirstInitiatedAt as a best-effort approximation.
-- Pre-launch: zero rows, so this is a no-op. Kept for replay safety on
-- any non-empty environment.
UPDATE "payments"
SET "paymentFirstInitiatedAt" = "paymentInitiatedAt"
WHERE "paymentFirstInitiatedAt" IS NULL
  AND "paymentInitiatedAt" IS NOT NULL;

CREATE INDEX "payments_status_paymentFirstInitiatedAt_idx"
  ON "payments"("status", "paymentFirstInitiatedAt");
