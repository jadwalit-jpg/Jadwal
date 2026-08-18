-- Drop the unused ActivityBlock.reason column.
-- Reason was removed from the API (DTO/logic/selects) and the vendor+admin UI;
-- it was never shown to customers. Only descriptive text is discarded — the
-- blocks themselves (dates/times) are untouched.
ALTER TABLE "activity_blocks" DROP COLUMN "reason";
