#!/bin/sh
# Prisma migration runner — run as a one-off ECS task before every deploy.
#
# Usage (local):
#   DATABASE_URL=... ./scripts/migrate.sh
#
# Usage (ECS RunTask — injected by the deploy pipeline):
#   aws ecs run-task \
#     --cluster jadwal-prod \
#     --task-definition jadwal-api:migrate \
#     --launch-type FARGATE \
#     --network-configuration "awsvpcConfiguration={subnets=[...],securityGroups=[...]}"
#
# The task definition points its command at this script and inherits the same
# DATABASE_URL secret as the main api service. Run it BEFORE updating the
# service (rolling deploy), otherwise workers may crash on a new column the
# schema hasn't received yet.

set -e

if [ -z "$DATABASE_URL" ]; then
  echo "[migrate] FATAL: DATABASE_URL is not set" >&2
  exit 1
fi

# Mask the credentials when logging — just show host for ops troubleshooting.
HOST=$(echo "$DATABASE_URL" | sed -E 's|^[a-z]+://[^@]+@([^/]+)/.*$|\1|')
echo "[migrate] Running prisma migrate deploy against ${HOST}"

cd "$(dirname "$0")/.."

# migrate deploy is idempotent + production-safe. It applies pending migrations
# in order and refuses to run if there's a `prisma migrate dev` shadow pending.
npx prisma migrate deploy

# Run seed ONLY when SEED_ON_MIGRATE=true (opt-in; defaults to off so re-runs
# don't spam inserts). For first-boot bootstrap, set SEED_ON_MIGRATE=true in
# the task definition one-shot. Remove after the initial deploy.
if [ "$SEED_ON_MIGRATE" = "true" ]; then
  echo "[migrate] SEED_ON_MIGRATE=true — running seed"
  npx prisma db seed || echo "[migrate] seed exited non-zero (safe to ignore on retry)"
fi

echo "[migrate] Done"
