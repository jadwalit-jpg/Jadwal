-- Wave 4 of business-logic remediation (plan §M4).
--
-- Adds `bankTransferRef` to `payments` so every system-PAID row links to
-- a real bank-side wire confirmation number. Required at the DTO level
-- (MarkPayoutPaidDto), but the column itself is nullable for backwards
-- compatibility with legacy rows marked PAID before this change.
--
-- VARCHAR(120) is intentionally generous — banks vary widely on
-- reference-number format (SWIFT MT103, IBAN-prefixed, internal txn
-- IDs, free-form notes for cash transfers). 120 chars covers every
-- format we've seen without becoming an unstructured text dump.

ALTER TABLE "payments"
  ADD COLUMN "bankTransferRef" VARCHAR(120);
