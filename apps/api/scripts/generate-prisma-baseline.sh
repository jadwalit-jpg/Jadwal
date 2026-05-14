#!/usr/bin/env bash
# Prisma drift baseline generator.
#
# WHAT IT DOES
#   Diffs the current `prisma/schema.prisma` against the replayed state of
#   `prisma/migrations/`. Emits the missing-DDL needed to reconcile, with a
#   timestamped migration directory ready to commit.
#
#   The drift exists because manual DB edits / schema changes landed without
#   matching migration files at some point in history. The runtime DB is
#   fine — Prisma's `migrate status` reports "up to date" — but a from-
#   scratch replay (i.e. `migrate dev` on a fresh DB, or `migrate reset`)
#   would diverge. This script captures the missing steps as a real
#   migration so future-from-scratch replays match production.
#
# PREREQ
#   1. Docker running (script spins up a throwaway Postgres for shadow-DB diff).
#   2. Run from `apps/api/`.
#   3. No uncommitted Prisma changes (the SQL emitted may otherwise be wrong).
#
# RUNNING
#   bash scripts/generate-prisma-baseline.sh
#
# OUTPUT
#   apps/api/prisma/migrations/<TS>_baseline_drift_reconcile/migration.sql
#   You then:
#     - Open the SQL, read it END-TO-END. Look for unintended DROPs.
#     - If anything looks wrong: `git checkout -- prisma/migrations/<TS>_*`
#       and STOP. Don't commit anything.
#     - On already-migrated DBs (prod, staging), apply with:
#       npx prisma migrate resolve --applied <TS>_baseline_drift_reconcile
#     - Commit the migration directory.
#
# WHY A SHADOW DB IS NEEDED
#   Prisma needs a real Postgres instance to replay the migrations directory
#   step-by-step, then introspect the result and diff it against
#   `schema.prisma`. The `--from-migrations` flag only works with
#   `shadowDatabaseUrl` set.
#
# SAFETY
#   - The shadow DB is a fresh throwaway container — your prod / staging /
#     dev DBs are NEVER touched by this script.
#   - The script container is removed at the end (`--rm`).
#   - Only files written: ONE new migration directory under
#     `prisma/migrations/`. Nothing else changes.
#   - Rollback: delete the new migration directory + uncommit.

set -euo pipefail

SHADOW_PORT="${SHADOW_PORT:-55433}"
SHADOW_CONTAINER="${SHADOW_CONTAINER:-prisma-shadow-$$}"
SHADOW_PASSWORD="${SHADOW_PASSWORD:-shadow}"
SHADOW_URL="postgresql://postgres:${SHADOW_PASSWORD}@localhost:${SHADOW_PORT}/postgres?schema=public"
TS="$(date -u +%Y%m%d%H%M%S)"
MIGRATION_NAME="${TS}_baseline_drift_reconcile"
MIGRATION_DIR="prisma/migrations/${MIGRATION_NAME}"

cleanup() {
  # Stop the shadow container regardless of exit status. Avoid `set -e`
  # exit-on-failure here since cleanup must not mask the original error.
  docker rm -f "${SHADOW_CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [ -d "${MIGRATION_DIR}" ]; then
  echo "ERROR: ${MIGRATION_DIR} already exists. Delete it (or pick a new timestamp) and re-run." >&2
  exit 1
fi

echo "==> Starting throwaway shadow Postgres on port ${SHADOW_PORT}..."
docker run -d --rm \
  --name "${SHADOW_CONTAINER}" \
  -e "POSTGRES_PASSWORD=${SHADOW_PASSWORD}" \
  -p "${SHADOW_PORT}:5432" \
  postgres:16-alpine >/dev/null

echo "==> Waiting for shadow Postgres to accept connections..."
for i in $(seq 1 30); do
  if docker exec "${SHADOW_CONTAINER}" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! docker exec "${SHADOW_CONTAINER}" pg_isready -U postgres >/dev/null 2>&1; then
  echo "ERROR: shadow Postgres did not become ready in 30s." >&2
  exit 1
fi

echo "==> Generating drift baseline SQL..."
mkdir -p "${MIGRATION_DIR}"

# --from-migrations: replays every existing migration against the shadow DB,
#   producing the "what migrations think the schema is" state.
# --to-schema:        the canonical truth — current schema.prisma.
# The output is the SQL needed to bring (1) to (2). That's the drift.
SHADOW_DATABASE_URL="${SHADOW_URL}" \
  npx prisma migrate diff \
    --from-migrations ./prisma/migrations \
    --to-schema ./prisma/schema.prisma \
    --script \
  > "${MIGRATION_DIR}/migration.sql"

LINES=$(wc -l < "${MIGRATION_DIR}/migration.sql" | tr -d ' ')

if [ "${LINES}" -le 2 ]; then
  echo "==> Baseline is empty — no drift detected. Removing empty migration." >&2
  rm -rf "${MIGRATION_DIR}"
  exit 0
fi

echo ""
echo "==> Drift baseline written to: ${MIGRATION_DIR}/migration.sql (${LINES} lines)"
echo ""
echo "NEXT STEPS:"
echo "  1. Open the SQL file and read it END-TO-END. Look for unintended"
echo "     DROPs (especially DROP COLUMN / DROP TABLE on user-facing tables)."
echo "  2. If it looks wrong: rm -rf ${MIGRATION_DIR} and stop."
echo "  3. If it looks right:"
echo "     a) Commit the migration directory."
echo "     b) On prod + staging (which are already-migrated DBs), run:"
echo "        npx prisma migrate resolve --applied ${MIGRATION_NAME}"
echo "        This RECORDS the migration as already-applied without running"
echo "        it. The runtime schema is unchanged."
echo "     c) On fresh dev DBs, npx prisma migrate dev now applies it cleanly"
echo "        and migrate dev becomes usable again going forward."
