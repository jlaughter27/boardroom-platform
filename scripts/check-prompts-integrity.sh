#!/usr/bin/env bash
# check-prompts-integrity.sh
#
# Asserts that the runtime persona prompt count doesn't accidentally drop
# during refactors, file moves, or careless deletes. The runtime loader
# (`packages/*/src/lib/prompt-loader.ts`) reads `*.system.md` files only;
# non-`.system.md` files in `docs/prompts/` are orchestrator one-shots and
# do not count.
#
# Threshold strategy:
#   1. Try to derive the floor from `git ls-files` (auto-tracks future
#      additions — adding a new prompt automatically lifts the floor on
#      next commit).
#   2. Fall back to a hard literal of 18 if git-baseline is unavailable
#      (fresh checkout, shallow clone, etc.).
#   3. Never let the floor drop below 18.
#
# Why 18?
#   Post-Phase-D-PR1 baseline. The 19th prompt (`quality-evaluator.system.md`)
#   is added by `ea24d43` which is deferred to PR 3 per the Zeta plan in
#   `docs/_inventory/PHASE-C-MIGRATION-MAP.md` v1.4. After PR 3 merges,
#   the git-baseline path will lift the floor to 19 automatically — no
#   need to edit this script.
#
# Wired into pre-deploy-check.sh and any future CI workflow.
# Usage: bash scripts/check-prompts-integrity.sh

set -euo pipefail

CURRENT=$(ls docs/prompts/*.system.md 2>/dev/null | wc -l | tr -d ' ')
BASELINE=$(git ls-files 'docs/prompts/*.system.md' 2>/dev/null | wc -l | tr -d ' ')

# If git baseline is missing or zero (fresh checkout, shallow clone), fall back to literal floor of 18
FLOOR=${BASELINE:-18}
[ "$FLOOR" -lt 18 ] && FLOOR=18

if [ -n "$BASELINE" ] && [ "$BASELINE" != "0" ]; then
  FLOOR_SOURCE="git ls-files=$BASELINE"
else
  FLOOR_SOURCE="literal=18"
fi

if [ "$CURRENT" -lt "$FLOOR" ]; then
  echo "FAIL: docs/prompts/*.system.md count is $CURRENT, expected ≥$FLOOR"
  echo "      (floor source: $FLOOR_SOURCE)"
  echo "      Did you accidentally delete or rename a system prompt?"
  exit 1
fi
echo "OK: $CURRENT system prompts present (floor=$FLOOR, source=$FLOOR_SOURCE)"
