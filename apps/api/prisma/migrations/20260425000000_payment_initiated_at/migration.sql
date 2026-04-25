-- AlterTable
ALTER TABLE "payments" ADD COLUMN "paymentInitiatedAt" TIMESTAMP(3);

-- Backfill: any existing payment that was already handed to PAY2M (has a
-- gatewayBasketId) gets paymentInitiatedAt = createdAt so the cleanup cron
-- case-3 sweep keeps catching pre-migration stale gateway sessions instead
-- of falling through to the 4h legacy safety net.
UPDATE "payments"
SET "paymentInitiatedAt" = "createdAt"
WHERE "gatewayBasketId" IS NOT NULL
  AND "paymentInitiatedAt" IS NULL;

-- CreateIndex
CREATE INDEX "payments_status_paymentInitiatedAt_idx" ON "payments"("status", "paymentInitiatedAt");
