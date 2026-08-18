-- MED#4 — DB-level backstop: at most one loyalty-ledger row per (bookingId, source).
--
-- The optimistic `updateMany WHERE status` locks in every cancel / refund / award
-- path ALREADY guarantee each (bookingId, source) is written at most once, so this
-- index is defense-in-depth against a FUTURE code path that forgets that lock — it
-- makes the database itself reject a duplicate points credit/debit.
--
-- PARTIAL (WHERE "bookingId" IS NOT NULL): ADMIN_ADJUST rows are not tied to a
-- booking and may legitimately repeat, so they are excluded. Mirrors the
-- partial-unique convention in 20260618000000_add_activity_special_prices
-- (lives in raw SQL only — Prisma cannot model a partial unique index, so it is
-- intentionally NOT declared in schema.prisma and Prisma leaves it untouched).
--
-- NON-BLOCKING by design: prod data cannot be pre-verified from CI, and a plain
-- CREATE UNIQUE INDEX would FAIL — and jam the entire deploy pipeline — if any
-- historical duplicate existed. So the index is created ONLY when the table is
-- already clean (the expected case). If a duplicate somehow exists we SKIP + WARN:
-- never delete a row (no data loss) and never abort (no pipeline jam). On a skip,
-- run the dup-check, reconcile the rows, and a follow-up migration adds the index.
DO $$
DECLARE dup_groups int;
BEGIN
  SELECT COUNT(*) INTO dup_groups FROM (
    SELECT 1
    FROM "loyalty_ledger"
    WHERE "bookingId" IS NOT NULL
    GROUP BY "bookingId", "source"
    HAVING COUNT(*) > 1
  ) d;

  IF dup_groups = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_ledger_bookingId_source_uq"
      ON "loyalty_ledger" ("bookingId", "source")
      WHERE "bookingId" IS NOT NULL;
    RAISE NOTICE 'MED4: loyalty_ledger (bookingId, source) unique index created';
  ELSE
    RAISE WARNING 'MED4: SKIPPED unique index — % duplicate (bookingId, source) group(s) present; reconcile then re-add via a follow-up migration', dup_groups;
  END IF;
END $$;
