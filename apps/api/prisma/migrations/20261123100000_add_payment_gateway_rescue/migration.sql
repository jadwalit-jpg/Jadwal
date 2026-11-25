-- Gateway-rescue markers on payments: lets admins see a debit-card (NAPS)
-- payment that PAY2M reported as successful but that the site could not
-- confirm (a held NAPS success, or a success-looking callback whose
-- Response_Key did not verify), alert them once, and record a manual
-- "Mark as paid" by an admin.
--
-- ADDITIVE (no data changed): six nullable columns and one index.
ALTER TABLE "payments" ADD COLUMN "napsHeldAt" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN "unverifiedCallbackAt" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN "unverifiedCallbackErrCode" VARCHAR(10);
ALTER TABLE "payments" ADD COLUMN "gatewayAlertedAt" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN "manualConfirmedAt" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN "manualConfirmedBy" VARCHAR(64);

CREATE INDEX "payments_status_napsHeldAt_idx" ON "payments"("status", "napsHeldAt");
