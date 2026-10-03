#!/bin/sh
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
#   2. Fall back to a hard literal of 18 if the git baseline is unavailable
#      (fresh checkout, shallow clone, Docker build context with no .git and
#      no git binary).
#   3. Never let the floor drop below 18.
#
# Why 18?
#   Post-Phase-D-PR1 baseline. Later prompts lift the floor automatically via
#   the git-baseline path — no need to edit this script.
#
# POSIX sh on purpose: both Dockerfiles run this inside node:20-alpine, which
# ships busybox sh and no bash. No `pipefail` (not POSIX), and a missing git
# must degrade to the literal floor instead of aborting the build.
#
# Wired into pre-deploy-check.sh, both Dockerfiles, and CI.
# Usage: sh scripts/check-prompts-integrity.sh

set -eu

CURRENT=$(ls docs/prompts/*.system.md 2>/dev/null | wc -l | tr -d ' ')

BASELINE=0
if command -v git >/dev/null 2>&1; then
  BASELINE=$(git ls-files 'docs/prompts/*.system.md' 2>/dev/null | wc -l | tr -d ' ') || BASELINE=0
fi
case "$BASELINE" in
  ''|*[!0-9]*) BASELINE=0 ;;
esac

FLOOR=$BASELINE
if [ "$FLOOR" -lt 18 ]; then FLOOR=18; fi

if [ "$BASELINE" -gt 0 ]; then
  FLOOR_SOURCE="git ls-files=$BASELINE"
else
  FLOOR_SOURCE="literal=18"
fi

if [ "$CURRENT" -lt "$FLOOR" ]; then
  echo "FAIL: docs/prompts/*.system.md count is $CURRENT, expected >=$FLOOR"
  echo "      (floor source: $FLOOR_SOURCE)"
  echo "      Did you accidentally delete or rename a system prompt?"
  exit 1
fi
echo "OK: $CURRENT system prompts present (floor=$FLOOR, source=$FLOOR_SOURCE)"
