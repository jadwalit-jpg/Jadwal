-- R3 — client-facing idempotency key for POST /payment/initiate.
--
-- Mirrors the gold-standard Booking.idempotencyKey pattern: an optional
-- client-supplied UUID v4 stamped ONCE on the first initiate call. A repeat
-- call with the same key for the same booking+owner is a legit retry; a key
-- that collides with a different booking/owner is rejected — the UNIQUE index
-- below is the race safety-net (P2002 → 409). Nullable, no default, so the
-- column is backwards-compatible with every existing payments row.
--
-- VARCHAR(64) matches Booking.idempotencyKey. CREATE UNIQUE INDEX on an
-- all-NULL column is instant; no CONCURRENTLY needed at this table size.

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "idempotencyKey" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");
