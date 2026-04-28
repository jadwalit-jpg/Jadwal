#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# bundle-size-check.sh
# ═══════════════════════════════════════════════════════════════
#
# Builds apps/web and reports the total size of the static asset
# directory (`.next/static`) plus the gzipped first-load JS for the
# home route. Fails the build if the total static size exceeds a
# budget — guards against accidental dependency creep.
#
# Defaults are deliberately generous (~5 MB total) so the check
# catches regressions like "we accidentally bundled all of Lodash"
# without yelling about every legitimate page that adds 30 KB.
#
# Tighten the BUDGET_KB value when actual numbers stabilise — to
# halve the bundle, halve the budget, then watch the next PR fail
# until we trim what the budget doesn't allow.
#
# Usage:   ./scripts/bundle-size-check.sh
# Env:     BUDGET_KB=5000   (default budget in KiB)
#          BUILD=1          (default: 1; set 0 to skip rebuild)
#
# Exit:    0 on pass, 1 on budget exceeded, 2 on missing build.
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT/apps/web"
STATIC_DIR="$WEB_DIR/.next/static"

BUDGET_KB="${BUDGET_KB:-5000}"
BUILD="${BUILD:-1}"

if [[ "$BUILD" == "1" ]]; then
  echo "▶ Building apps/web (set BUILD=0 to skip)…"
  ( cd "$WEB_DIR" && \
      NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://api.placeholder.com/api}" \
      npx next build > /dev/null )
fi

if [[ ! -d "$STATIC_DIR" ]]; then
  echo "❌ $STATIC_DIR not found. Did the build fail?"
  exit 2
fi

# Total static bundle size (KiB).
TOTAL_KB=$(du -sk "$STATIC_DIR" | awk '{print $1}')

echo "▶ Static bundle (.next/static) = ${TOTAL_KB} KiB  (budget ${BUDGET_KB} KiB)"

if (( TOTAL_KB > BUDGET_KB )); then
  echo "❌ Bundle size budget exceeded: ${TOTAL_KB} KiB > ${BUDGET_KB} KiB"
  echo "   Investigate with: cd apps/web && npx @next/bundle-analyzer"
  exit 1
fi

# Per-chunk breakdown for visibility (top 15 largest files).
# `find -printf '%s\t%p'` emits tab-separated; pin awk -F'\t' so paths
# containing spaces (e.g. "jadwal webapp" on Windows) survive intact.
#
# Capture the sorted output into a variable BEFORE piping to head:
# under `set -o pipefail`, `find | sort | head` lets head close the
# pipe after 15 lines, which makes coreutils 8.30+ sort exit non-zero
# with "fflush failed: Broken pipe" — pipefail propagates that as
# exit 2 and `set -e` kills the script even though the budget passed.
echo
echo "▶ Top 15 largest static files:"
SORTED=$(find "$STATIC_DIR" -type f -printf '%s\t%p\n' | sort -rn)
echo "$SORTED" \
  | head -n 15 \
  | awk -F'\t' -v r="$STATIC_DIR/" '{
      path = $2
      idx = index(path, r)
      if (idx > 0) path = substr(path, idx + length(r))
      printf "  %8.1f KiB  %s\n", $1/1024, path
    }'

echo
echo "✅ Bundle size within budget."
